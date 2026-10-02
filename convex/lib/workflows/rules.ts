import type { Doc, Id } from '../../_generated/dataModel';
import type {
  WorkflowEmailEvent,
  WorkflowNode,
  WorkflowSmsEvent,
  WorkflowTrigger,
} from '../../_lib/validators/workflows';
import type { FilterField } from '../../_lib/validators/filters';
import { NO_STEP_ISSUE, stepIssue, stepIssueMessage } from '../../_lib/validators/workflowSteps';
import {
  isTransitionAllowed,
  pipelineStage,
  stageRequiresTag,
  validateStageTags,
} from '../../_lib/validators/deals';
import { validateLeadTargetValue } from '../leads/targets';

/** Pure helpers, without ctx or db: the public mutations and the trigger dispatcher share them. */

const MAX_NODES = 50;
export const MAX_STEPS_PER_RUN = 100;
/** Per-workflow-per-lead enrollment cap bounding cross-workflow ping-pong. */
export const MAX_ENROLLMENTS_PER_LEAD_PER_DAY = 5;
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** Outgoing references of a node, in branch order. */
function nodeChildIds(node: WorkflowNode): string[] {
  if (node.type === 'branch') {
    return [node.nextTrue, node.nextFalse].filter((id): id is string => id !== undefined);
  }
  return node.next !== undefined ? [node.next] : [];
}

/** The structural checks that hold even for a draft; the error is in French because it is shown to the user. */
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

/** The gate before activation: the graph must be a strict tree (no cycle, no orphan, no shared child) and every node's config complete. */
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

  if (!startNodeId || nodes.length === 0) return NO_STEP_ISSUE;

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
    const issue =
      stepIssue(node) ??
      storedIssue(node, defsById, listIds, lifecycleStageKeys, pipelines, trigger);
    if (issue) return stepIssueMessage(node, issue);
  }

  return null;
}

/** What only the database can tell of a step: that what it names exists, and that the pipeline allows the move. */
function storedIssue(
  node: WorkflowNode,
  defsById: Map<string, Doc<'propertyDefinitions'>>,
  listIds: Set<string>,
  lifecycleStageKeys: Set<string>,
  pipelines: Map<string, Doc<'pipelines'>>,
  trigger: WorkflowTrigger | undefined,
): string | null {
  switch (node.type) {
    case 'update_property':
      return validateLeadTargetValue(node.target, node.value, defsById);
    case 'set_lifecycle_stage':
      return node.stage && lifecycleStageKeys.has(node.stage) ? null : 'statut introuvable.';
    case 'create_deal':
      if (pipelines.size === 0) return 'aucun pipeline.';
      return validatePipelineStageRef(node, pipelines);
    case 'update_deal_stage':
      return (
        validatePipelineStageRef(node, pipelines) ??
        validateStageTagsRef(node, pipelines) ??
        validateStageTransitionFromTrigger(node, trigger, pipelines)
      );
    case 'add_to_list':
    case 'remove_from_list':
      return node.listId && listIds.has(node.listId) ? null : 'liste introuvable.';
    default:
      return null;
  }
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

/** An occurrence of a triggerable event on a lead, matched against the trigger of each active workflow. */
export type WorkflowTriggerEvent =
  | { type: 'lead_created' }
  | { type: 'lead_property_changed'; changedFields: FilterField[] }
  | { type: 'list_membership_changed'; change: 'added' | 'removed'; listId: Id<'leadLists'> }
  | { type: 'consent_updated' }
  | { type: 'campaign_email_event'; event: WorkflowEmailEvent; campaignId: Id<'campaigns'> }
  | { type: 'campaign_sms_event'; event: WorkflowSmsEvent; campaignId: Id<'campaigns'> }
  | { type: 'tracked_link_click'; campaignId: Id<'campaigns'>; linkKey: string }
  | { type: 'score_threshold_crossed'; oldScore: number; newScore: number }
  | { type: 'form_submitted'; formId: Id<'forms'> }
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
    case 'score_threshold_crossed':
      return (
        event.type === 'score_threshold_crossed' &&
        (trigger.direction === 'up'
          ? event.oldScore < trigger.threshold && event.newScore >= trigger.threshold
          : event.oldScore >= trigger.threshold && event.newScore < trigger.threshold)
      );
    case 'form_submitted':
      return (
        event.type === 'form_submitted' &&
        (trigger.formId === undefined || trigger.formId === event.formId)
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
  'companyId',
] as const;

/** The fields a lead patch really changes, the payload of `lead_property_changed`; `customProperties` is replaced whole, so it is compared key by key. */
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
