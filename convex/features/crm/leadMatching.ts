import type { Doc } from '../../_generated/dataModel';
import type { LeadPropertyValue } from '../../_lib/validators/leadProperties';
import {
  isActiveRule,
  type AdvancedFilter,
  type FilterField,
  type FilterGroup,
  type FilterRule,
  type FilterRuleValue,
} from '../../_lib/validators/leadFilters';

/**
 * Pure, in-memory evaluation of the advanced (group-based) lead filter. Kept
 * dependency-free (types + {@link isActiveRule} only) so it stays trivially
 * testable and reusable, separate from the Convex query wiring in queries.ts.
 */

/** A stored value is "empty" for isEmpty/isNotEmpty. `false`/`0` count as set. */
export function isEmptyValue(value: LeadPropertyValue | undefined): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Ordering compare: numeric when both numbers, else lexicographic (ISO dates sort correctly). */
function compareValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** A scalar comparable for gt/lt/between, or null when the value isn't orderable. */
function toComparable(value: unknown): string | number | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

/** Resolve the stored value of a rule's field (standard column or custom prop). */
export function getFieldValue(
  lead: Doc<'leads'>,
  field: FilterField,
): LeadPropertyValue | undefined {
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
    case 'assignedTo':
      return lead.assignedTo;
    case 'isRedFlagged':
      return lead.isRedFlagged;
    case 'marketingConsent':
      // Array value; `contains` does membership, isEmpty/isNotEmpty test presence.
      return lead.marketingConsent;
  }
}

function equalsMatch(stored: LeadPropertyValue, value: FilterRuleValue): boolean {
  // Range value doesn't apply to equals.
  if (typeof value === 'object' && !Array.isArray(value)) return false;
  const allowed = Array.isArray(value) ? value : [value];
  if (Array.isArray(stored)) return stored.some((s) => allowed.includes(s));
  return allowed.includes(stored);
}

function containsMatch(stored: LeadPropertyValue, value: FilterRuleValue): boolean {
  // checkbox stored array → matches when it holds any of the wanted options.
  if (Array.isArray(stored)) {
    const wanted = Array.isArray(value) ? value : [value];
    return stored.some((s) => wanted.includes(s));
  }
  if (typeof stored !== 'string') return false;
  const needles = Array.isArray(value) ? value : [value];
  const hay = stored.toLowerCase();
  return needles.some((n) => typeof n === 'string' && hay.includes(n.toLowerCase()));
}

/** Evaluate one rule against a lead. */
export function evalRule(lead: Doc<'leads'>, rule: FilterRule): boolean {
  const stored = getFieldValue(lead, rule.field);

  if (rule.operator === 'isEmpty') return isEmptyValue(stored);
  if (rule.operator === 'isNotEmpty') return !isEmptyValue(stored);

  // Remaining operators need a present stored value and a rule value.
  if (isEmptyValue(stored) || stored === undefined) return false;
  if (rule.value === undefined) return true;

  switch (rule.operator) {
    case 'equals':
      return equalsMatch(stored, rule.value);
    case 'contains':
      return containsMatch(stored, rule.value);
    case 'gt':
    case 'lt': {
      const a = toComparable(stored);
      const b = toComparable(rule.value);
      if (a === null || b === null) return true;
      const cmp = compareValues(a, b);
      return rule.operator === 'gt' ? cmp > 0 : cmp < 0;
    }
    case 'between': {
      const val = rule.value;
      if (typeof val !== 'object' || Array.isArray(val)) return true;
      const a = toComparable(stored);
      if (a === null) return true;
      if (val.min !== undefined && compareValues(a, val.min) < 0) return false;
      if (val.max !== undefined && compareValues(a, val.max) > 0) return false;
      return true;
    }
    default:
      return true;
  }
}

/** A group's verdict, or null when it holds no active rules (neutral). */
export function evalGroup(lead: Doc<'leads'>, group: FilterGroup): boolean | null {
  const rules = group.rules.filter(isActiveRule);
  if (rules.length === 0) return null;
  return group.combinator === 'or'
    ? rules.some((r) => evalRule(lead, r))
    : rules.every((r) => evalRule(lead, r));
}

/** Evaluate the whole advanced-filter tree; neutral (no active rules) ⇒ match. */
export function evalAdvancedFilter(lead: Doc<'leads'>, filter: AdvancedFilter): boolean {
  const verdicts = filter.groups
    .map((g) => evalGroup(lead, g))
    .filter((r): r is boolean => r !== null);
  if (verdicts.length === 0) return true;
  return filter.combinator === 'or' ? verdicts.some(Boolean) : verdicts.every(Boolean);
}
