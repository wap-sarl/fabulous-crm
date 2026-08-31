import type { FilterRule, LeadAdvancedFilter, LeadStandardField } from '@crm/lib/backend';
import { CONSENT_CHANNELS } from '../../../lib/constants';
import type { FieldCatalog, StandardFieldSpec } from '../../filters/lib/advancedFilter';
import type { PropertyDefinitionRow } from '../../properties/types';

/**
 * Lead columns writable through the CRM forms, with French label + filter
 * type. Also the pickable fields of the « propriété modifiée » trigger — the
 * behavioural/derived columns below never go through updateLead.
 */
export const LEAD_FILTER_FIELDS: StandardFieldSpec<LeadStandardField>[] = [
  { field: 'firstName', label: 'Prénom', type: 'text' },
  { field: 'lastName', label: 'Nom', type: 'text' },
  { field: 'email', label: 'E-mail', type: 'text' },
  { field: 'phone', label: 'Téléphone', type: 'text' },
  { field: 'comment', label: 'Commentaire', type: 'text' },
  { field: 'lifecycleStage', label: 'Statut', type: 'lifecycle' },
  { field: 'ownerIds', label: 'Propriétaires', type: 'assignee' },
  { field: 'isRedFlagged', label: 'Signalé', type: 'boolean' },
  {
    field: 'marketingConsent',
    label: 'Consentement marketing',
    type: 'checkbox',
    options: CONSENT_CHANNELS.map((c) => ({ value: c.value, label: c.label })),
  },
  { field: 'companyId', label: 'Entreprise', type: 'select' },
];

/** Live options the full catalog needs: companies and lead lists. */
export interface LeadCatalogOptions {
  companies?: { _id: string; name: string }[];
  lists?: { _id: string; name: string }[];
}

const BEHAVIOUR = 'Comportement';

/** Every lead column the advanced filter offers, behavioural signals included. */
export function leadFilterFields(
  opts: LeadCatalogOptions = {},
): StandardFieldSpec<LeadStandardField>[] {
  const companies = (opts.companies ?? []).map((c) => ({ value: c._id, label: c.name }));
  const lists = (opts.lists ?? []).map((l) => ({ value: l._id, label: l.name }));
  return [
    ...LEAD_FILTER_FIELDS.map((f) => (f.field === 'companyId' ? { ...f, options: companies } : f)),
    { field: 'createdAt', label: 'Date de création', type: 'timestamp' },
    { field: 'leadScore', label: 'Score', type: 'number' },
    { field: 'lastActivityAt', label: 'Dernière activité', type: 'timestamp', group: BEHAVIOUR },
    { field: 'lastEmailOpenAt', label: 'A ouvert un e-mail', type: 'timestamp', group: BEHAVIOUR },
    {
      field: 'emailOpenCount',
      label: "Ouvertures d'e-mail (nombre)",
      type: 'number',
      group: BEHAVIOUR,
    },
    { field: 'lastEmailClickAt', label: 'A cliqué un lien', type: 'timestamp', group: BEHAVIOUR },
    { field: 'emailClickCount', label: 'Clics de lien (nombre)', type: 'number', group: BEHAVIOUR },
    {
      field: 'lastFormSubmissionAt',
      label: 'A soumis un formulaire',
      type: 'timestamp',
      group: BEHAVIOUR,
    },
    {
      field: 'formSubmissionCount',
      label: 'Formulaires soumis (nombre)',
      type: 'number',
      group: BEHAVIOUR,
    },
    { field: 'lastPageViewAt', label: 'A visité une page', type: 'timestamp', group: BEHAVIOUR },
    { field: 'pageViewCount', label: 'Pages vues (nombre)', type: 'number', group: BEHAVIOUR },
    { field: 'listIds', label: 'Listes', type: 'list', options: lists, group: BEHAVIOUR },
  ];
}

export const LEAD_FIELD_LABEL: Record<LeadStandardField, string> = Object.fromEntries(
  leadFilterFields().map((f) => [f.field, f.label]),
) as Record<LeadStandardField, string>;

/** The lead catalog for the builder: built-in columns + the lead definitions. */
export function leadFieldCatalog(
  definitions: PropertyDefinitionRow[],
  opts: LeadCatalogOptions = {},
): FieldCatalog<LeadStandardField> {
  return { standard: leadFilterFields(opts), definitions };
}

/** The `marketingConsent` value auto-seeded for a given campaign channel. */
const CHANNEL_CONSENT: Record<'email' | 'sms', string> = { email: 'email', sms: 'sms' };

type LeadRule = FilterRule<LeadStandardField>;

export function applyRecipientFilter(
  filter: LeadAdvancedFilter | undefined,
  channel: 'email' | 'sms',
  messageType: 'marketing' | 'transactional',
): LeadAdvancedFilter {
  const channelField: LeadStandardField = channel === 'email' ? 'email' : 'phone';
  const isChannelRule = (r: LeadRule) =>
    r.field.kind === 'standard' &&
    (r.field.field === 'email' || r.field.field === 'phone') &&
    r.operator === 'isNotEmpty';
  // Only the single-value email/sms consent rules are auto-managed; a manually
  // authored consent rule (other channels, or multiple values) is left alone.
  const isAutoConsentRule = (r: LeadRule) =>
    r.field.kind === 'standard' &&
    r.field.field === 'marketingConsent' &&
    r.operator === 'contains' &&
    Array.isArray(r.value) &&
    r.value.length === 1 &&
    (r.value[0] === 'email' || r.value[0] === 'sms');

  const channelRule: LeadRule = {
    field: { kind: 'standard', field: channelField },
    operator: 'isNotEmpty',
    value: undefined,
  };
  const consentRule: LeadRule | null =
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
