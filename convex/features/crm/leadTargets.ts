import type { MutationCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import {
  validatePropertyValue,
  customPropertyParamKey,
  formatPropertyParamValue,
  type PropertyValue,
} from '../../_lib/validators/properties';
import { formatAddressLines } from '../../_lib/validators/addressFormats';
import { DEFAULT_COUNTRY } from '../../_lib/validators/companyRegistry';
import type { TrackedLinkStandardField } from '../../_lib/validators/crm';
import { lifecycleStageLabel, type LifecycleConfig } from '../../_lib/validators/lifecycle';

/**
 * Lead-targeting helpers shared by campaign tracked links and workflow
 * `update_property` steps: both point at a built-in lead column or a
 * custom-property definition and write a validated value to it.
 */

/** A writable lead target — the `target` shape of tracked links and workflow nodes. */
export type LeadTarget =
  | { kind: 'standard'; field: TrackedLinkStandardField }
  | { kind: 'custom'; propertyDefId: Id<'propertyDefinitions'> };

/**
 * One-line postal address for {{ params.address }} in the country's writing
 * order, '' when unset. The country code is appended only for foreign
 * addresses — a domestic mailing doesn't repeat the country.
 */
export function formatAddressParam(address: Doc<'leads'>['address']): string {
  if (!address) return '';
  const lines = formatAddressLines(address);
  if (address.country && address.country !== DEFAULT_COUNTRY) lines.push(address.country);
  return lines.join(', ');
}

/**
 * A lead's merge params ({{ params.x }}): the standard columns, one
 * `custom_<defId>` entry per property definition, and the consent-page URL.
 * Shared by campaign sends (which add tracked-link URLs on top) and workflow
 * send steps.
 */
export function buildLeadParams(
  lead: Doc<'leads'>,
  defsById: Map<string, Doc<'propertyDefinitions'>>,
  consentBase: string,
  // {{ params.status }} is the lead's status label (its lifecycle stage).
  lifecycle: LifecycleConfig,
): Record<string, string> {
  const params: Record<string, string> = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    status: lead.lifecycleStage ? lifecycleStageLabel(lifecycle, lead.lifecycleStage) : '',
    comment: lead.comment ?? '',
    address: formatAddressParam(lead.address),
    consentUrl: `${consentBase}/consent/${lead.consentToken}`,
  };
  for (const def of defsById.values()) {
    params[customPropertyParamKey(def._id)] = formatPropertyParamValue(
      def,
      lead.customProperties?.[def._id],
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
  value: PropertyValue,
  defsById: Map<string, Doc<'propertyDefinitions'>>,
): string | null {
  if (target.kind === 'custom') {
    const def = defsById.get(target.propertyDefId as string);
    if (!def) return 'propriété introuvable ou supprimée.';
    return validatePropertyValue(def, value);
  }
  const { field } = target;
  switch (field) {
    case 'isRedFlagged':
      return typeof value === 'boolean' ? null : 'valeur oui/non requise.';
    case 'email':
      if (typeof value !== 'string' || value.trim() === '') return 'texte requis.';
      return validatePropertyValue({ type: 'email' }, value);
    default:
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
  value: PropertyValue,
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
    case 'isRedFlagged':
      return typeof value === 'boolean' ? { isRedFlagged: value } : null;
    default:
      // firstName / lastName / email / phone / comment
      return typeof value === 'string' ? { [field]: value } : null;
  }
}
