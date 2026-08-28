import type { Doc, Id } from '../../_generated/dataModel';
import type {
  WorkflowEmailEvent,
  WorkflowNode,
  WorkflowSmsEvent,
  WorkflowTrigger,
} from '../../_lib/validators/workflows';
import {
  isActiveRule,
  type LeadAdvancedFilter,
  type FilterField,
} from '../../_lib/validators/filters';
import {
  isTransitionAllowed,
  pipelineStage,
  stageRequiresTag,
  validateStageTags,
} from '../../_lib/validators/deals';
import { validateLeadTargetValue } from '../crm/leadTargets';

/**
 * Pure helpers of the workflow engine: limits, graph validation, trigger
 * matching and the changed-fields diff. No ctx, no db — shared by the public
 * mutations (validation at activation) and the trigger dispatcher.
 */

export const MAX_NODES = 50;
export const MAX_STEPS_PER_RUN = 100;
/** Per-workflow-per-lead enrollment cap bounding cross-workflow ping-pong. */
export const MAX_ENROLLMENTS_PER_LEAD_PER_DAY = 5;
export const MIN_WAIT_MS = 60_000;
export const MAX_WAIT_MS = 90 * 24 * 60 * 60 * 1000;
export const WEBHOOK_TIMEOUT_MS = 10_000;

const WAIT_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

/** Sleep duration of a wait node. Bounds are enforced by validateWorkflowGraph. */
export function delayMs(node: { amount: number; unit: keyof typeof WAIT_UNIT_MS }): number {
  return node.amount * WAIT_UNIT_MS[node.unit];
}

/** Outgoing references of a node, in branch order. */
export function nodeChildIds(node: WorkflowNode): string[] {
  if (node.type === 'branch') {
    return [node.nextTrue, node.nextFalse].filter((id): id is string => id !== undefined);
  }
  return node.next !== undefined ? [node.next] : [];
}

const countActiveRules = (filter: LeadAdvancedFilter) =>
  filter.groups.reduce((n, g) => n + g.rules.filter(isActiveRule).length, 0);

/**
 * Structural checks that must hold even for drafts: unique non-empty ids,
 * every edge referencing an existing node, bounded size. Returns a French
 * error, or `null`.
 */
export function lightValidateGraph(nodes: WorkflowNode[], startNodeId?: string): string | null {
  if (nodes.length > MAX_NODES) return `Un workflow est limité à ${MAX_NODES} étapes.`;
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.id) return 'Étape sans identifiant.';
    if (ids.has(node.id)) return `Identifiant d'étape en double : ${node.id}.`;
    ids.add(node.id);
  }
  if (startNodeId !== undefined && !ids.has(startNodeId)) {
    return 'La première étape référencée est introuvable.';
  }
  for (const node of nodes) {
    for (const child of nodeChildIds(node)) {
      if (!ids.has(child)) return `Une étape référence une étape introuvable (${child}).`;
    }
  }
  return null;
}

const NODE_TYPE_LABELS: Record<WorkflowNode['type'], string> = {
  send_email: 'Envoyer un e-mail',
  send_sms: 'Envoyer un SMS',
  update_property: 'Modifier une propriété',
  set_lifecycle_stage: 'Changer le statut',
  create_deal: 'Créer une transaction',
  update_deal_stage: 'Changer le stade d’une transaction',
  create_task: 'Créer une tâche',
  add_to_list: 'Ajouter à une liste',
  remove_from_list: 'Retirer d’une liste',
  wait: 'Attendre',
  webhook: 'Webhook',
  branch: 'Condition',
};

/**
 * Full validation gate before a workflow can be activated. On top of
 * {@link lightValidateGraph}: a start node, every node reachable exactly once
 * (strict tree — no cycles, no orphans, no shared children) and each node's
 * config complete. Returns a French error, or `null` when activable.
 */
export function validateWorkflowGraph(
  nodes: WorkflowNode[],
  startNodeId: string | undefined,
  defsById: Map<string, Doc<'propertyDefinitions'>>,
  listIds: Set<string>,
  lifecycleStageKeys: Set<string>,
  pipelines: Map<string, Doc<'pipelines'>>,
  trigger?: WorkflowTrigger,
): string | null {
  const lightError = lightValidateGraph(nodes, startNodeId);
  if (lightError) return lightError;

  if (!startNodeId || nodes.length === 0) return 'Ajoutez au moins une étape.';

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Walk from the start; the graph is only valid as a strict tree.
  const seen = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) {
      return 'Le graphe contient un cycle ou une étape atteinte par deux chemins.';
    }
    seen.add(id);
    queue.push(...nodeChildIds(byId.get(id)!));
  }
  if (seen.size !== nodes.length) {
    return 'Certaines étapes ne sont pas reliées au parcours.';
  }

  for (const node of nodes) {
    const label = `Étape « ${NODE_TYPE_LABELS[node.type]} »`;
    switch (node.type) {
      case 'send_email':
        if (!node.subject.trim()) return `${label} : l'objet est requis.`;
        if (!node.htmlBody.trim()) return `${label} : le contenu est requis.`;
        break;
      case 'send_sms':
        if (!node.smsBody.trim()) return `${label} : le message est requis.`;
        break;
      case 'update_property': {
        const error = validateLeadTargetValue(node.target, node.value, defsById);
        if (error) return `${label} : ${error}`;
        break;
      }
      case 'set_lifecycle_stage':
        if (!node.stage) return `${label} : choisissez un statut.`;
        if (!lifecycleStageKeys.has(node.stage)) return `${label} : statut introuvable.`;
        break;
      case 'create_deal': {
        if (!node.title.trim()) return `${label} : l'intitulé est requis.`;
        if (node.amount !== undefined && (!Number.isFinite(node.amount) || node.amount < 0)) {
          return `${label} : montant invalide.`;
        }
        if (pipelines.size === 0) return `${label} : aucun pipeline.`;
        const error = validatePipelineStageRef(node, pipelines);
        if (error) return `${label} : ${error}`;
        break;
      }
      case 'create_task':
        if (!node.title.trim()) return `${label} : l'intitulé est requis.`;
        if (
          node.dueInDays !== undefined &&
          (!Number.isInteger(node.dueInDays) || node.dueInDays < 0 || node.dueInDays > 365)
        ) {
          return `${label} : échéance invalide (0 à 365 jours).`;
        }
        break;
      case 'update_deal_stage': {
        if (!node.stageKey) return `${label} : choisissez un stade.`;
        const error =
          validatePipelineStageRef(node, pipelines) ??
          validateStageTagsRef(node, pipelines) ??
          validateStageTransitionFromTrigger(node, trigger, pipelines);
        if (error) return `${label} : ${error}`;
        break;
      }
      case 'add_to_list':
      case 'remove_from_list':
        if (!node.listId) return `${label} : choisissez une liste.`;
        if (!listIds.has(node.listId)) return `${label} : liste introuvable.`;
        break;
      case 'wait': {
        if (!Number.isFinite(node.amount) || node.amount < 1 || !Number.isInteger(node.amount)) {
          return `${label} : durée invalide.`;
        }
        const ms = delayMs(node);
        if (ms < MIN_WAIT_MS) return `${label} : durée minimale 1 minute.`;
        if (ms > MAX_WAIT_MS) return `${label} : durée maximale 90 jours.`;
        break;
      }
      case 'webhook':
        if (!/^https?:\/\//.test(node.url)) {
          return `${label} : l'URL doit commencer par http(s)://`;
        }
        break;
      case 'branch':
        if (countActiveRules(node.condition) === 0) {
          return `${label} : au moins une condition est requise.`;
        }
        break;
    }
  }

  return null;
}

function validatePipelineStageRef(
  node: { pipelineId?: Id<'pipelines'>; stageKey?: string },
  pipelines: Map<string, Doc<'pipelines'>>,
): string | null {
  if (node.pipelineId !== undefined && !pipelines.has(node.pipelineId)) {
    return 'pipeline introuvable.';
  }
  if (node.stageKey !== undefined) {
    const candidates = node.pipelineId
      ? [pipelines.get(node.pipelineId)!]
      : [...pipelines.values()];
    if (!candidates.some((p) => p.stages.some((s) => s.key === node.stageKey))) {
      return 'stade introuvable.';
    }
  }
  return null;
}

/** A stage requiring tags needs at least one; given tags must exist on the target stage. */
function validateStageTagsRef(
  node: { pipelineId?: Id<'pipelines'>; stageKey?: string; tags?: string[] },
  pipelines: Map<string, Doc<'pipelines'>>,
): string | null {
  if (!node.stageKey) return null;
  const candidates = node.pipelineId ? [pipelines.get(node.pipelineId)!] : [...pipelines.values()];
  for (const pipeline of candidates) {
    const stage = pipelineStage(pipeline, node.stageKey);
    if (!stage) continue;
    if (stageRequiresTag(stage) && !node.tags?.length) return 'choisissez au moins une étiquette.';
    if (node.tags?.length && validateStageTags(stage, node.tags) === null) {
      return 'étiquette introuvable.';
    }
  }
  return null;
}

function validateStageTransitionFromTrigger(
  node: { pipelineId?: Id<'pipelines'>; stageKey?: string },
  trigger: WorkflowTrigger | undefined,
  pipelines: Map<string, Doc<'pipelines'>>,
): string | null {
  if (trigger?.type !== 'deal_stage_changed' || !trigger.pipelineId || !trigger.stageKey) {
    return null;
  }
  if (node.pipelineId !== undefined && node.pipelineId !== trigger.pipelineId) return null;
  const pipeline = pipelines.get(trigger.pipelineId);
  if (!pipeline || !node.stageKey) return null;
  if (isTransitionAllowed(pipeline, trigger.stageKey, node.stageKey)) return null;
  const labelOf = (key: string) => pipelineStage(pipeline, key)?.label ?? key;
  return `transition interdite de « ${labelOf(trigger.stageKey)} » vers « ${labelOf(node.stageKey)} » dans ce pipeline.`;
}

/**
 * An occurrence of a triggerable event on a lead, dispatched by the CRM
 * mutations. Matched against each active workflow's trigger config.
 */
export type WorkflowTriggerEvent =
  | { type: 'lead_created' }
  | { type: 'lead_property_changed'; changedFields: FilterField[] }
  | { type: 'list_membership_changed'; change: 'added' | 'removed'; listId: Id<'leadLists'> }
  | { type: 'consent_updated' }
  | { type: 'campaign_email_event'; event: WorkflowEmailEvent; campaignId: Id<'campaigns'> }
  | { type: 'campaign_sms_event'; event: WorkflowSmsEvent; campaignId: Id<'campaigns'> }
  | { type: 'tracked_link_click'; campaignId: Id<'campaigns'>; linkKey: string }
  | { type: 'deal_created'; pipelineId: Id<'pipelines'>; dealId: Id<'deals'> }
  | {
      type: 'deal_stage_changed';
      pipelineId: Id<'pipelines'>;
      stageKey: string;
      dealId: Id<'deals'>;
    }
  | { type: 'deal_won'; pipelineId: Id<'pipelines'>; dealId: Id<'deals'> }
  | { type: 'deal_lost'; pipelineId: Id<'pipelines'>; dealId: Id<'deals'> };

const fieldKey = (f: FilterField) =>
  f.kind === 'standard' ? `std:${f.field}` : `cp:${f.definitionId}`;

/** Whether a dispatched event satisfies a workflow's trigger config. */
export function matchesTrigger(trigger: WorkflowTrigger, event: WorkflowTriggerEvent): boolean {
  if (trigger.type !== event.type) return false;
  switch (trigger.type) {
    case 'lead_created':
    case 'consent_updated':
      return true;
    case 'lead_property_changed': {
      if (event.type !== 'lead_property_changed') return false;
      if (!trigger.watchedFields || trigger.watchedFields.length === 0) return true;
      const watched = new Set(trigger.watchedFields.map(fieldKey));
      return event.changedFields.some((f) => watched.has(fieldKey(f)));
    }
    case 'list_membership_changed':
      return (
        event.type === 'list_membership_changed' &&
        trigger.change === event.change &&
        (trigger.listId === undefined || trigger.listId === event.listId)
      );
    case 'campaign_email_event':
      return (
        event.type === 'campaign_email_event' &&
        trigger.event === event.event &&
        (trigger.campaignId === undefined || trigger.campaignId === event.campaignId)
      );
    case 'campaign_sms_event':
      return (
        event.type === 'campaign_sms_event' &&
        trigger.event === event.event &&
        (trigger.campaignId === undefined || trigger.campaignId === event.campaignId)
      );
    case 'tracked_link_click':
      return (
        event.type === 'tracked_link_click' &&
        (trigger.campaignId === undefined || trigger.campaignId === event.campaignId) &&
        (trigger.linkKey === undefined || trigger.linkKey === event.linkKey)
      );
    case 'deal_created':
    case 'deal_won':
    case 'deal_lost':
      return (
        event.type === trigger.type &&
        (trigger.pipelineId === undefined || trigger.pipelineId === event.pipelineId)
      );
    case 'deal_stage_changed':
      return (
        event.type === 'deal_stage_changed' &&
        (trigger.pipelineId === undefined || trigger.pipelineId === event.pipelineId) &&
        (trigger.stageKey === undefined || trigger.stageKey === event.stageKey)
      );
  }
}

/** Standard lead columns the advanced filter can target (mirrors standardFieldValidator). */
const FILTERABLE_STANDARD_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'comment',
  'lifecycleStage',
  'ownerIds',
  'isRedFlagged',
  'marketingConsent',
] as const;

/**
 * Which filterable fields a lead patch actually changes — the payload of a
 * `lead_property_changed` event. JSON-compares each provided key against the
 * current doc; `customProperties` (whole-record replace) is diffed per key.
 */
export function diffLeadFilterFields(
  lead: Doc<'leads'>,
  updates: Record<string, unknown>,
): FilterField[] {
  const changed: FilterField[] = [];
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

  for (const field of FILTERABLE_STANDARD_FIELDS) {
    if (field in updates && differs(updates[field], lead[field])) {
      changed.push({ kind: 'standard', field });
    }
  }

  if ('customProperties' in updates) {
    const before = lead.customProperties ?? {};
    const after = (updates.customProperties ?? {}) as Record<string, unknown>;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (differs(before[key], after[key])) changed.push({ kind: 'custom', definitionId: key });
    }
  }

  return changed;
}
