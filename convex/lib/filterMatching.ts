import {
  type AdvancedFilter,
  type FilterField,
  type FilterGroup,
  type FilterRule,
  type FilterRuleValue,
  isActiveRule,
} from '../_lib/validators/filters';
import type { PropertyValue } from '../_lib/validators/properties';

/** Resolves a rule's field to the record's stored value (standard column or custom prop). */
export type FieldValueGetter<F extends string> = (
  field: FilterField<F>,
) => PropertyValue | undefined;

/** A stored value is "empty" for isEmpty/isNotEmpty. `false`/`0` count as set. */
export function isEmptyValue(value: PropertyValue | undefined): boolean {
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

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].+)?$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Epoch ms of a stored date: finite numbers pass, ISO-looking strings parse; null otherwise. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** A rule's date bound in ms; a date-only string used as an upper bound means its last ms. */
function boundEpochMs(value: string | number, bound: 'start' | 'end'): number | null {
  const ms = toEpochMs(value);
  if (ms === null) return null;
  return typeof value === 'string' && bound === 'end' && DATE_ONLY_RE.test(value)
    ? ms + DAY_MS - 1
    : ms;
}

/**
 * Both sides as same-typed comparables — a mixed timestamp/date-string pair
 * goes through epoch ms, `bound` telling which edge of a date-only value the
 * comparison targets. Null when the pair cannot be compared meaningfully.
 */
function comparablePair(
  stored: unknown,
  value: unknown,
  bound: 'start' | 'end',
): [string | number, string | number] | null {
  const a = toComparable(stored);
  const b = toComparable(value);
  if (a === null || b === null) return null;
  if (typeof a === typeof b) return [a, b];
  const am = toEpochMs(a);
  const bm = boundEpochMs(b, bound);
  return am === null || bm === null ? null : [am, bm];
}

function equalsMatch(stored: PropertyValue, value: FilterRuleValue): boolean {
  // Range value doesn't apply to equals.
  if (typeof value === 'object' && !Array.isArray(value)) return false;
  const allowed = Array.isArray(value) ? value : [value];
  if (Array.isArray(stored)) return stored.some((s) => allowed.includes(s));
  return allowed.includes(stored);
}

function containsMatch(stored: PropertyValue, value: FilterRuleValue): boolean {
  if (Array.isArray(stored)) {
    const wanted = Array.isArray(value) ? value : [value];
    return stored.some((s) => wanted.includes(s));
  }
  if (typeof stored !== 'string') return false;
  const needles = Array.isArray(value) ? value : [value];
  const hay = stored.toLowerCase();
  return needles.some((n) => typeof n === 'string' && hay.includes(n.toLowerCase()));
}

/** Evaluate one rule against a record. `now` anchors the relative-date operators. */
export function evalFilterRule<F extends string>(
  getValue: FieldValueGetter<F>,
  rule: FilterRule<F>,
  now: number = Date.now(),
): boolean {
  const stored = getValue(rule.field);

  if (rule.operator === 'isEmpty') return isEmptyValue(stored);
  if (rule.operator === 'isNotEmpty') return !isEmptyValue(stored);

  if (rule.operator === 'notEquals') {
    if (rule.value === undefined) return true;
    if (isEmptyValue(stored) || stored === undefined) return true;
    return !equalsMatch(stored, rule.value);
  }

  if (isEmptyValue(stored) || stored === undefined) return false;
  if (rule.value === undefined) return true;

  switch (rule.operator) {
    case 'equals':
      return equalsMatch(stored, rule.value);
    case 'contains':
      return containsMatch(stored, rule.value);
    // A configured rule whose value can't be compared to the stored one fails
    // closed: malformed data must exclude a lead, never enroll it (PR #68).
    case 'gt':
    case 'lt': {
      // « après le 31/08 » excludes the whole day; « avant » stops at its start.
      const pair = comparablePair(stored, rule.value, rule.operator === 'gt' ? 'end' : 'start');
      if (pair === null) return false;
      const cmp = compareValues(pair[0], pair[1]);
      return rule.operator === 'gt' ? cmp > 0 : cmp < 0;
    }
    case 'between': {
      const val = rule.value;
      if (typeof val !== 'object' || Array.isArray(val)) return false;
      if (val.min !== undefined) {
        const min = comparablePair(stored, val.min, 'start');
        if (min === null || compareValues(min[0], min[1]) < 0) return false;
      }
      if (val.max !== undefined) {
        const max = comparablePair(stored, val.max, 'end');
        if (max === null || compareValues(max[0], max[1]) > 0) return false;
      }
      return true;
    }
    case 'inLastDays':
    case 'inNextDays':
    case 'moreThanDaysAgo': {
      const at = toEpochMs(stored);
      const days = typeof rule.value === 'number' ? rule.value : Number(rule.value);
      if (at === null || !Number.isFinite(days)) return false;
      if (rule.operator === 'inLastDays') return at >= now - days * DAY_MS && at <= now;
      if (rule.operator === 'inNextDays') return at >= now && at <= now + days * DAY_MS;
      return at < now - days * DAY_MS;
    }
    default:
      return false;
  }
}

/** A group's verdict, or null when it holds no active rules (neutral). */
export function evalFilterGroup<F extends string>(
  getValue: FieldValueGetter<F>,
  group: FilterGroup<F>,
  now: number = Date.now(),
): boolean | null {
  const rules = group.rules.filter(isActiveRule);
  if (rules.length === 0) return null;
  return group.combinator === 'or'
    ? rules.some((r) => evalFilterRule(getValue, r, now))
    : rules.every((r) => evalFilterRule(getValue, r, now));
}

/** Evaluate the whole advanced-filter tree; neutral (no active rules) ⇒ match. */
export function evalFilter<F extends string>(
  getValue: FieldValueGetter<F>,
  filter: AdvancedFilter<F>,
  now: number = Date.now(),
): boolean {
  const verdicts = filter.groups
    .map((g) => evalFilterGroup(getValue, g, now))
    .filter((r): r is boolean => r !== null);
  if (verdicts.length === 0) return true;
  return filter.combinator === 'or' ? verdicts.some(Boolean) : verdicts.every(Boolean);
}
