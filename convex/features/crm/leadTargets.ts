import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import {
  validateLeadPropertyValue,
  customPropertyParamKey,
  formatLeadPropertyParamValue,
  type LeadPropertyValue,
} from '../../_lib/validators/leadProperties';
import { LEAD_STATUS_LABELS, type TrackedLinkStandardField, type LeadStatus } from '../../_lib/validators/crm';

/**
 * Lead-targeting helpers shared by campaign tracked links and workflow
 * `update_property` steps: both point at a built-in lead column or a
 * custom-property definition and write a validated value to it.
 */

/** A writable lead target — the `target` shape of tracked links and workflow nodes. */
export type LeadTarget =
  | { kind: 'standard'; field: TrackedLinkStandardField }
  | { kind: 'custom'; propertyDefId: Id<'leadPropertyDefinitions'> };

/** One-line postal address for {{ params.address }}; '' when unset/empty. */
export function formatAddressParam(address: Doc<'leads'>['address']): string {
  if (!address) return '';
  const street = [address.streetNumber, address.street].filter(Boolean).join(' ');
  const city = [address.postalCode, address.city].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}

/**
 * A lead's merge params ({{ params.x }}): the standard columns, one
 * `custom_<defId>` entry per property definition, and the consent-page URL.
 * Shared by campaign sends (which add tracked-link URLs on top) and workflow
 * send steps.
 */
export function buildLeadParams(
  lead: Doc<'leads'>,
  defsById: Map<string, Doc<'leadPropertyDefinitions'>>,
  consentBase: string
): Record<string, string> {
  const params: Record<string, string> = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    status: LEAD_STATUS_LABELS[lead.status],
    comment: lead.comment ?? '',
    address: formatAddressParam(lead.address),
    consentUrl: `${consentBase}/consent/${lead.consentToken}`,
  };
  for (const def of defsById.values()) {
    params[customPropertyParamKey(def._id)] = formatLeadPropertyParamValue(
      def,
      lead.customProperties?.[def._id]
    );
  }
  return params;
}

/**
 * Validate a value against its lead target — a custom-property definition
 * (type + rules) or a built-in lead field. Returns a French error message, or
 * `null` when valid.
 */
export function validateLeadTargetValue(
  target: LeadTarget,
  value: LeadPropertyValue,
  defsById: Map<string, Doc<'leadPropertyDefinitions'>>
): string | null {
  if (target.kind === 'custom') {
    const def = defsById.get(target.propertyDefId as string);
    if (!def) return 'propriété introuvable ou supprimée.';
    return validateLeadPropertyValue(def, value);
  }
  const { field } = target;
  switch (field) {
    case 'status':
      return typeof value === 'string' && value in LEAD_STATUS_LABELS ? null : 'statut invalide.';
    case 'isRedFlagged':
      return typeof value === 'boolean' ? null : 'valeur oui/non requise.';
    case 'email':
      // validateLeadPropertyValue lets empty values through — require one here.
      if (typeof value !== 'string' || value.trim() === '') return 'texte requis.';
      return validateLeadPropertyValue({ type: 'email' }, value);
    default:
      // firstName / lastName / phone / comment — a non-empty string.
      return typeof value === 'string' && value.trim() !== '' ? null : 'texte requis.';
  }
}

/**
 * The lead patch writing `value` to `target`, or `null` when it can't (deleted
 * custom-property definition, or a stored value whose type no longer matches
 * its built-in field — validated when authored, re-checked here defensively
 * since execution happens long after).
 */
export async function buildLeadTargetPatch(
  ctx: MutationCtx,
  lead: Doc<'leads'>,
  target: LeadTarget,
  value: LeadPropertyValue
): Promise<Partial<Doc<'leads'>> | null> {
  if (target.kind === 'custom') {
    const def = await ctx.db.get(target.propertyDefId);
    if (!def || def.deletedAt !== undefined) return null;
    return {
      customProperties: { ...lead.customProperties, [target.propertyDefId]: value },
    };
  }
  const { field } = target;
  switch (field) {
    case 'status':
      return typeof value === 'string' && value in LEAD_STATUS_LABELS
        ? { status: value as LeadStatus }
        : null;
    case 'isRedFlagged':
      return typeof value === 'boolean' ? { isRedFlagged: value } : null;
    default:
      // firstName / lastName / email / phone / comment
      return typeof value === 'string' ? { [field]: value } : null;
  }
}
