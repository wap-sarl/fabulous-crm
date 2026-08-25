import type { LucideIcon } from 'lucide-react';
import {
  Clock,
  Handshake,
  ListMinus,
  ListPlus,
  Mail,
  MessageSquare,
  Milestone,
  PenLine,
  Split,
  Webhook,
  KanbanSquare,
} from 'lucide-react';
import type {
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRunStatus,
  WorkflowStatus,
  WorkflowStepOutcome,
  WorkflowTrigger,
  WorkflowTriggerType,
  WorkflowWaitUnit,
} from '@crm/lib/backend';
import type { StatusTone } from '@crm/design-system';
import { STANDARD_FILTER_FIELDS } from '../../leads/lib/advancedFilter';

/** French copy and per-type metadata of the workflow feature. */

/** One entry of the flat trigger-event Select (a trigger type × its event). */
export type TriggerOptionValue =
  | 'lead_created'
  | 'lead_property_changed'
  | 'list_added'
  | 'list_removed'
  | 'consent_updated'
  | 'email_delivered'
  | 'email_opened'
  | 'email_clicked'
  | 'email_hard_bounce'
  | 'email_soft_bounce'
  | 'email_unsubscribed'
  | 'sms_delivered'
  | 'sms_reply'
  | 'sms_stop'
  | 'link_click'
  | 'deal_created'
  | 'deal_stage_changed'
  | 'deal_won'
  | 'deal_lost';

export const TRIGGER_GROUPS: {
  label: string;
  options: { value: TriggerOptionValue; label: string }[];
}[] = [
  {
    label: 'Leads',
    options: [
      { value: 'lead_created', label: 'Lead créé' },
      { value: 'lead_property_changed', label: 'Propriété modifiée' },
    ],
  },
  {
    label: 'Listes',
    options: [
      { value: 'list_added', label: 'Ajouté à une liste' },
      { value: 'list_removed', label: 'Retiré d’une liste' },
    ],
  },
  {
    label: 'Consentement',
    options: [{ value: 'consent_updated', label: 'Consentement mis à jour' }],
  },
  {
    label: 'E-mail (campagnes)',
    options: [
      { value: 'email_delivered', label: 'E-mail délivré' },
      { value: 'email_opened', label: 'E-mail ouvert' },
      { value: 'email_clicked', label: 'Clic dans un e-mail' },
      { value: 'email_hard_bounce', label: 'Bounce définitif (hard)' },
      { value: 'email_soft_bounce', label: 'Bounce temporaire (soft)' },
      { value: 'email_unsubscribed', label: 'Désinscription e-mail' },
    ],
  },
  {
    label: 'SMS (campagnes)',
    options: [
      { value: 'sms_delivered', label: 'SMS délivré' },
      { value: 'sms_reply', label: 'Réponse SMS' },
      { value: 'sms_stop', label: 'STOP reçu' },
    ],
  },
  {
    label: 'Liens suivis',
    options: [{ value: 'link_click', label: 'Clic sur un lien suivi' }],
  },
  {
    label: 'Transactions',
    options: [
      { value: 'deal_created', label: 'Transaction créée' },
      { value: 'deal_stage_changed', label: 'Transaction changée de stade' },
      { value: 'deal_won', label: 'Transaction gagnée' },
      { value: 'deal_lost', label: 'Transaction perdue' },
    ],
  },
];

const TRIGGER_OPTION_LABEL = new Map<TriggerOptionValue, string>(
  TRIGGER_GROUPS.flatMap((g) => g.options).map((o) => [o.value, o.label]),
);

/** Flat Select value of a stored trigger. */
export function triggerToOption(trigger: WorkflowTrigger): TriggerOptionValue {
  switch (trigger.type) {
    case 'lead_created':
    case 'lead_property_changed':
    case 'consent_updated':
      return trigger.type;
    case 'list_membership_changed':
      return trigger.change === 'added' ? 'list_added' : 'list_removed';
    case 'campaign_email_event':
      return `email_${trigger.event}`;
    case 'campaign_sms_event':
      return SMS_EVENT_TO_OPTION[trigger.event];
    case 'tracked_link_click':
      return 'link_click';
    case 'deal_created':
    case 'deal_stage_changed':
    case 'deal_won':
    case 'deal_lost':
      return trigger.type;
  }
}

const SMS_EVENT_TO_OPTION = {
  delivered: 'sms_delivered',
  sms_reply: 'sms_reply',
  stop: 'sms_stop',
} as const satisfies Record<string, TriggerOptionValue>;

const SMS_OPTION_TO_EVENT = {
  sms_delivered: 'delivered',
  sms_reply: 'sms_reply',
  sms_stop: 'stop',
} as const;

/**
 * Build the trigger for a picked Select value, carrying over the previous
 * trigger's refinements (list, campaign) when they still apply.
 */
export function optionToTrigger(
  value: TriggerOptionValue,
  prev: WorkflowTrigger | null,
): WorkflowTrigger {
  const prevListId = prev?.type === 'list_membership_changed' ? prev.listId : undefined;
  const prevCampaignId =
    prev?.type === 'campaign_email_event' ||
    prev?.type === 'campaign_sms_event' ||
    prev?.type === 'tracked_link_click'
      ? prev.campaignId
      : undefined;
  const prevPipelineId =
    prev?.type === 'deal_created' ||
    prev?.type === 'deal_stage_changed' ||
    prev?.type === 'deal_won' ||
    prev?.type === 'deal_lost'
      ? prev.pipelineId
      : undefined;

  switch (value) {
    case 'lead_created':
    case 'consent_updated':
      return { type: value };
    case 'lead_property_changed':
      return {
        type: 'lead_property_changed',
        watchedFields: prev?.type === 'lead_property_changed' ? prev.watchedFields : undefined,
      };
    case 'list_added':
    case 'list_removed':
      return {
        type: 'list_membership_changed',
        change: value === 'list_added' ? 'added' : 'removed',
        listId: prevListId,
      };
    case 'link_click':
      return { type: 'tracked_link_click', campaignId: prevCampaignId };
    case 'deal_created':
    case 'deal_won':
    case 'deal_lost':
      return { type: value, pipelineId: prevPipelineId };
    case 'deal_stage_changed':
      return {
        type: 'deal_stage_changed',
        pipelineId: prevPipelineId,
        stageKey: prev?.type === 'deal_stage_changed' ? prev.stageKey : undefined,
      };
    case 'sms_delivered':
    case 'sms_reply':
    case 'sms_stop':
      return {
        type: 'campaign_sms_event',
        event: SMS_OPTION_TO_EVENT[value],
        campaignId: prevCampaignId,
      };
    default:
      return {
        type: 'campaign_email_event',
        event: value.slice('email_'.length) as Extract<
          WorkflowTrigger,
          { type: 'campaign_email_event' }
        >['event'],
        campaignId: prevCampaignId,
      };
  }
}

/** Precise French label of a configured trigger. */
export function triggerLabel(trigger: WorkflowTrigger): string {
  return TRIGGER_OPTION_LABEL.get(triggerToOption(trigger)) ?? trigger.type;
}

/** Generic label per trigger *type* (list page, run history `triggerType`). */
export const TRIGGER_TYPE_LABEL: Record<WorkflowTriggerType | 'manual' | 'bulk_reenroll', string> =
  {
    lead_created: 'Lead créé',
    lead_property_changed: 'Propriété modifiée',
    list_membership_changed: 'Liste (ajout / retrait)',
    consent_updated: 'Consentement mis à jour',
    campaign_email_event: 'Événement e-mail',
    campaign_sms_event: 'Événement SMS',
    tracked_link_click: 'Clic sur un lien suivi',
    deal_created: 'Transaction créée',
    deal_stage_changed: 'Transaction changée de stade',
    deal_won: 'Transaction gagnée',
    deal_lost: 'Transaction perdue',
    manual: 'Inscription manuelle',
    bulk_reenroll: 'Réinscription en masse',
  };

export const STEP_TYPES: {
  type: WorkflowNodeType;
  label: string;
  icon: LucideIcon;
}[] = [
  { type: 'send_email', label: 'Envoyer un e-mail', icon: Mail },
  { type: 'send_sms', label: 'Envoyer un SMS', icon: MessageSquare },
  { type: 'update_property', label: 'Modifier une propriété', icon: PenLine },
  { type: 'set_lifecycle_stage', label: 'Changer le statut du lead', icon: Milestone },
  { type: 'create_deal', label: 'Créer une transaction', icon: Handshake },
  { type: 'update_deal_stage', label: 'Changer le stade d’une transaction', icon: KanbanSquare },
  { type: 'add_to_list', label: 'Ajouter à une liste', icon: ListPlus },
  { type: 'remove_from_list', label: 'Retirer d’une liste', icon: ListMinus },
  { type: 'wait', label: 'Attendre', icon: Clock },
  { type: 'webhook', label: 'Webhook', icon: Webhook },
  { type: 'branch', label: 'Condition (Si / Sinon)', icon: Split },
];

export const STEP_TYPE_META = new Map(STEP_TYPES.map((s) => [s.type, s]));

export const WORKFLOW_STATUSES: { value: WorkflowStatus; label: string; tone: StatusTone }[] = [
  { value: 'draft', label: 'Brouillon', tone: 'gray' },
  { value: 'active', label: 'Actif', tone: 'green' },
  { value: 'paused', label: 'En pause', tone: 'amber' },
];
export const WORKFLOW_STATUS_LABEL = Object.fromEntries(
  WORKFLOW_STATUSES.map((s) => [s.value, s.label]),
) as Record<WorkflowStatus, string>;
export const WORKFLOW_STATUS_TONE = Object.fromEntries(
  WORKFLOW_STATUSES.map((s) => [s.value, s.tone]),
) as Record<WorkflowStatus, StatusTone>;

export const RUN_STATUS_LABEL: Record<WorkflowRunStatus, string> = {
  active: 'En cours',
  completed: 'Terminé',
  cancelled: 'Annulé',
  failed: 'Échec',
};
export const RUN_STATUS_TONE: Record<WorkflowRunStatus, StatusTone> = {
  active: 'blue',
  completed: 'green',
  cancelled: 'gray',
  failed: 'red',
};

export const STEP_OUTCOME_LABEL: Record<WorkflowStepOutcome, string> = {
  pending: 'En cours',
  success: 'Fait',
  failed: 'Échec',
  skipped_no_consent: 'Ignoré (pas de consentement)',
  skipped_no_email: 'Ignoré (pas d’e-mail)',
  skipped_no_phone: 'Ignoré (pas de téléphone)',
  skipped: 'Ignoré',
};
export const STEP_OUTCOME_TONE: Record<WorkflowStepOutcome, StatusTone> = {
  pending: 'blue',
  success: 'green',
  failed: 'red',
  skipped_no_consent: 'amber',
  skipped_no_email: 'amber',
  skipped_no_phone: 'amber',
  skipped: 'gray',
};

export const WAIT_UNIT_LABEL: Record<WorkflowWaitUnit, { singular: string; plural: string }> = {
  minutes: { singular: 'minute', plural: 'minutes' },
  hours: { singular: 'heure', plural: 'heures' },
  days: { singular: 'jour', plural: 'jours' },
};

const STANDARD_FIELD_LABEL = new Map(STANDARD_FILTER_FIELDS.map((f) => [f.field, f.label]));

/** One-line card subtitle describing a node's configuration. */
export function nodeSummary(
  node: WorkflowNode,
  ctx: {
    listNameById: Map<string, string>;
    definitionLabelById: Map<string, string>;
    lifecycleStageLabelByKey: Map<string, string>;
    pipelineNameById: Map<string, string>;
    stageLabel: (pipelineId: string | undefined, stageKey: string) => string;
  },
): string {
  switch (node.type) {
    case 'send_email':
      return node.subject.trim() || 'Objet à définir';
    case 'send_sms':
      return node.smsBody.trim() ? node.smsBody.trim().slice(0, 60) : 'Message à définir';
    case 'update_property': {
      const label =
        node.target.kind === 'standard'
          ? (STANDARD_FIELD_LABEL.get(node.target.field) ?? node.target.field)
          : (ctx.definitionLabelById.get(node.target.propertyDefId) ?? 'Propriété supprimée');
      return `${label} → ${formatValue(node.value)}`;
    }
    case 'set_lifecycle_stage':
      return node.stage
        ? `Étape : ${ctx.lifecycleStageLabelByKey.get(node.stage) ?? node.stage}`
        : 'Étape à choisir';
    case 'create_deal':
      return node.title.trim()
        ? `${node.title.trim().slice(0, 40)}${node.pipelineId ? ` · ${ctx.pipelineNameById.get(node.pipelineId) ?? 'pipeline'}` : ''}`
        : 'Intitulé à définir';
    case 'update_deal_stage':
      return node.stageKey
        ? `Stade : ${ctx.stageLabel(node.pipelineId, node.stageKey)}`
        : 'Stade à choisir';
    case 'add_to_list':
    case 'remove_from_list':
      return node.listId
        ? `Liste : ${ctx.listNameById.get(node.listId) ?? 'introuvable'}`
        : 'Liste à choisir';
    case 'wait': {
      const unit = WAIT_UNIT_LABEL[node.unit];
      return `Attendre ${node.amount} ${node.amount > 1 ? unit.plural : unit.singular}`;
    }
    case 'webhook':
      return node.url.trim() ? node.url.replace(/^https?:\/\//, '').slice(0, 60) : 'URL à définir';
    case 'branch': {
      const count = node.condition.groups.reduce((n, g) => n + g.rules.length, 0);
      return `${count} condition(s)`;
    }
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}
