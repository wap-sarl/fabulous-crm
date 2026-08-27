import type { Doc } from '../../_generated/dataModel';
import type {
  FilterField,
  FilterRule,
  LeadAdvancedFilter,
  LeadStandardField,
} from '../../_lib/validators/filters';
import type { PropertyValue } from '../../_lib/validators/properties';
import { evalFilter, evalFilterRule } from '../../lib/filterMatching';

/** Resolve the stored value of a rule's field (standard column or custom prop). */
export function getFieldValue(
  lead: Doc<'leads'>,
  field: FilterField<LeadStandardField>,
): PropertyValue | undefined {
  if (field.kind === 'custom') return lead.customProperties?.[field.definitionId];
  switch (field.field) {
    case 'firstName':
      return lead.firstName;
    case 'lastName':
      return lead.lastName;
    case 'email':
      return lead.email;
    case 'phone':
      return lead.phone;
    case 'comment':
      return lead.comment;
    case 'lifecycleStage':
      return lead.lifecycleStage;
    case 'ownerIds':
      // Array value; `equals` matches when any owner is among the wanted ones.
      return lead.ownerIds;
    case 'isRedFlagged':
      return lead.isRedFlagged;
    case 'marketingConsent':
      // Array value; `contains` does membership, isEmpty/isNotEmpty test presence.
      return lead.marketingConsent;
  }
}

/** Evaluate one rule against a lead. */
export function evalRule(lead: Doc<'leads'>, rule: FilterRule<LeadStandardField>): boolean {
  return evalFilterRule((field) => getFieldValue(lead, field), rule);
}

/** Evaluate the whole advanced-filter tree against a lead; neutral (no active rules) ⇒ match. */
export function evalAdvancedFilter(lead: Doc<'leads'>, filter: LeadAdvancedFilter): boolean {
  return evalFilter((field) => getFieldValue(lead, field), filter);
}
