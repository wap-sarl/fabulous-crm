import type {
  AdvancedFilter,
  FilterField,
  FilterFieldType,
  FilterGroup,
  FilterOperator,
  FilterRule,
  StandardField,
} from '@crm/lib/backend';
import { isActiveRule } from '@crm/lib/backend';
import type { LeadPropertyDefinitionRow } from '../types';

/** Standard lead columns exposed in the builder, with French label + filter type. */
export const STANDARD_FILTER_FIELDS: {
  field: StandardField;
  label: string;
  type: FilterFieldType;
}[] = [
  { field: 'firstName', label: 'Prénom', type: 'text' },
  { field: 'lastName', label: 'Nom', type: 'text' },
  { field: 'email', label: 'E-mail', type: 'text' },
  { field: 'phone', label: 'Téléphone', type: 'text' },
  { field: 'comment', label: 'Commentaire', type: 'text' },
  { field: 'status', label: 'Statut', type: 'status' },
  { field: 'lifecycleStage', label: 'Statut du lead', type: 'lifecycle' },
  { field: 'assignedTo', label: 'Assigné à', type: 'assignee' },
  { field: 'isRedFlagged', label: 'Signalé', type: 'boolean' },
  { field: 'marketingConsent', label: 'Consentement marketing', type: 'checkbox' },
];

const STANDARD_FIELD_TYPE = new Map<StandardField, FilterFieldType>(
  STANDARD_FILTER_FIELDS.map((f) => [f.field, f.type]),
);

const STANDARD_FIELD_LABEL = new Map<StandardField, string>(
  STANDARD_FILTER_FIELDS.map((f) => [f.field, f.label]),
);

/** French labels for each operator (shown in the operator dropdown). */
export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  equals: 'Égal à',
  contains: 'Contient',
  isEmpty: 'Est vide',
  isNotEmpty: "N'est pas vide",
  gt: 'Supérieur à',
  lt: 'Inférieur à',
  between: 'Entre',
};

/** Map a custom-property type to its unified filter-field type (radio ≈ select). */
function customPropertyType(type: LeadPropertyDefinitionRow['type']): FilterFieldType {
  switch (type) {
    case 'radio':
      return 'select';
    case 'rpps':
      // RPPS is stored as a plain string; filter it like free text.
      return 'text';
    case 'text':
    case 'number':
    case 'email':
    case 'select':
    case 'checkbox':
    case 'date':
    case 'boolean':
      return type;
  }
}

/** Resolve a rule field to its unified filter type; defaults to text for orphans. */
export function fieldTypeOf(
  field: FilterField,
  defsById: Map<string, LeadPropertyDefinitionRow>,
): FilterFieldType {
  if (field.kind === 'standard') return STANDARD_FIELD_TYPE.get(field.field) ?? 'text';
  const def = defsById.get(field.definitionId);
  return def ? customPropertyType(def.type) : 'text';
}

/** Human label for a rule field (standard label or the custom definition label). */
export function fieldLabelOf(
  field: FilterField,
  defsById: Map<string, LeadPropertyDefinitionRow>,
): string {
  if (field.kind === 'standard') return STANDARD_FIELD_LABEL.get(field.field) ?? field.field;
  return defsById.get(field.definitionId)?.label ?? 'Propriété supprimée';
}

/** A fresh rule seeded on the first standard field (Prénom, contains). */
export function emptyRule(): FilterRule {
  return {
    field: { kind: 'standard', field: 'firstName' },
    operator: 'contains',
    value: undefined,
  };
}

export function emptyGroup(): FilterGroup {
  return { combinator: 'and', rules: [emptyRule()] };
}

export function emptyAdvancedFilter(): AdvancedFilter {
  return { combinator: 'and', groups: [emptyGroup()] };
}

/** The `marketingConsent` value auto-seeded for a given campaign channel. */
const CHANNEL_CONSENT: Record<'email' | 'sms', string> = { email: 'email', sms: 'sms' };

/**
 * Maintain the auto-managed recipient rules for a campaign:
 *  • a channel presence rule (email/phone "is not empty"), and
 *  • for marketing campaigns, a consent rule (`marketingConsent` contains the
 *    channel's consent) so we only target leads who opted into that channel.
 *
 * Both are stripped and re-seeded on every call, prepended to the first group,
 * while every other rule the user added is preserved. The consent rule is left
 * visible and editable in the builder; transactional campaigns seed none.
 */
export function applyRecipientFilter(
  filter: AdvancedFilter | undefined,
  channel: 'email' | 'sms',
  messageType: 'marketing' | 'transactional',
): AdvancedFilter {
  const channelField: StandardField = channel === 'email' ? 'email' : 'phone';
  const isChannelRule = (r: FilterRule) =>
    r.field.kind === 'standard' &&
    (r.field.field === 'email' || r.field.field === 'phone') &&
    r.operator === 'isNotEmpty';
  // Only the single-value email/sms consent rules are auto-managed; a manually
  // authored consent rule (other channels, or multiple values) is left alone.
  const isAutoConsentRule = (r: FilterRule) =>
    r.field.kind === 'standard' &&
    r.field.field === 'marketingConsent' &&
    r.operator === 'contains' &&
    Array.isArray(r.value) &&
    r.value.length === 1 &&
    (r.value[0] === 'email' || r.value[0] === 'sms');

  const channelRule: FilterRule = {
    field: { kind: 'standard', field: channelField },
    operator: 'isNotEmpty',
    value: undefined,
  };
  const consentRule: FilterRule | null =
    messageType === 'marketing'
      ? {
          field: { kind: 'standard', field: 'marketingConsent' },
          operator: 'contains',
          value: [CHANNEL_CONSENT[channel]],
        }
      : null;
  const seeded = consentRule ? [channelRule, consentRule] : [channelRule];

  // No fallback placeholder rule: when there is no existing filter we want a
  // clean group holding only the seeded rules.
  const base = filter ?? { combinator: 'and' as const, groups: [] };
  // Strip existing auto-managed rules, dropping groups left empty…
  let groups = base.groups
    .map((g) => ({
      ...g,
      rules: g.rules.filter((r) => !isChannelRule(r) && !isAutoConsentRule(r)),
    }))
    .filter((g) => g.rules.length > 0);
  if (groups.length === 0) groups = [{ combinator: 'and', rules: [] }];
  // …then prepend the seeded rules to the first group.
  groups = groups.map((g, i) => (i === 0 ? { ...g, rules: [...seeded, ...g.rules] } : g));
  return { combinator: base.combinator, groups };
}

/** Total number of rules that actually affect matching, across all groups. */
export function countActiveRules(filter: AdvancedFilter | undefined): number {
  if (!filter) return 0;
  return filter.groups.reduce((sum, g) => sum + g.rules.filter(isActiveRule).length, 0);
}

/**
 * Serialize an advanced filter for the URL. Returns `undefined` when it has no
 * active rules, so the `af` param is dropped rather than left as noise.
 */
export function serializeAdvancedFilter(filter: AdvancedFilter | undefined): string | undefined {
  if (!filter || countActiveRules(filter) === 0) return undefined;
  // Keep only groups with active rules; drop incomplete rules within them.
  const groups = filter.groups
    .map((g) => ({ combinator: g.combinator, rules: g.rules.filter(isActiveRule) }))
    .filter((g) => g.rules.length > 0);
  if (groups.length === 0) return undefined;
  return JSON.stringify({ combinator: filter.combinator, groups });
}

/** Parse the `af` URL param back to an AdvancedFilter; returns undefined on any error. */
export function parseAdvancedFilter(raw: string | null): AdvancedFilter | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as AdvancedFilter).groups)
    ) {
      return undefined;
    }
    return parsed as AdvancedFilter;
  } catch {
    return undefined;
  }
}
