import type { Doc } from '../../_generated/dataModel';
import type {
  FilterField,
  FilterOperator,
  FilterRule,
  LeadAdvancedFilter,
  LeadStandardField,
} from '../../_lib/validators/filters';
import type { PropertyValue } from '../../_lib/validators/properties';
import { evalFilter, evalFilterRule } from '../filters/matching';

/** Out-of-document inputs a lead filter can need: list membership, eval time. */
export interface LeadFilterExtras {
  /** Ids of the filter-referenced lists the lead belongs to (resolved via by_list_lead). */
  memberListIds?: string[];
  now?: number;
}

/** Resolve the stored value of a rule's field (standard column or custom prop). */
function getFieldValue(
  lead: Doc<'leads'>,
  field: FilterField<LeadStandardField>,
  extras?: LeadFilterExtras,
  operator?: FilterOperator,
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
    case 'companyId':
      return lead.companyId;
    case 'createdAt':
      return lead._creationTime;
    case 'leadScore':
      return lead.leadScore;
    case 'lastActivityAt':
      return lead.lastActivityAt;
    case 'lastEmailOpenAt':
      return lead.lastEmailOpenAt;
    case 'emailOpenCount':
      return lead.emailOpenCount ?? 0;
    case 'lastEmailClickAt':
      return lead.lastEmailClickAt;
    case 'emailClickCount':
      return lead.emailClickCount ?? 0;
    case 'lastFormSubmissionAt':
      return lead.lastFormSubmissionAt;
    case 'formSubmissionCount':
      return lead.formSubmissionCount ?? 0;
    case 'lastPageViewAt':
      return lead.lastPageViewAt;
    case 'pageViewCount':
      return lead.pageViewCount ?? 0;
    case 'visitedPages':
      // « contains » is a substring of some path (one text); the others are asked of each path (the list).
      if (!lead.visitedPages?.length) return undefined;
      return operator === 'contains' ? lead.visitedPages.join('\n') : lead.visitedPages;
    case 'listIds':
      return extras?.memberListIds ?? [];
  }
}

/** Evaluate one rule against a lead. */
export function evalRule(
  lead: Doc<'leads'>,
  rule: FilterRule<LeadStandardField>,
  extras?: LeadFilterExtras,
): boolean {
  return evalFilterRule(
    (field, operator) => getFieldValue(lead, field, extras, operator),
    rule,
    extras?.now,
  );
}

/** Evaluate the whole advanced-filter tree against a lead; neutral (no active rules) ⇒ match. */
export function evalAdvancedFilter(
  lead: Doc<'leads'>,
  filter: LeadAdvancedFilter,
  extras?: LeadFilterExtras,
): boolean {
  return evalFilter(
    (field, operator) => getFieldValue(lead, field, extras, operator),
    filter,
    extras?.now,
  );
}
