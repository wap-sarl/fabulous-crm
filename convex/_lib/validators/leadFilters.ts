import { type Infer, v } from 'convex/values';

/**
 * The advanced-filter model for the leads list. A two-level boolean tree:
 * an {@link AdvancedFilter} combines its {@link FilterGroup}s with AND/OR, and
 * each group combines its {@link FilterRule}s with AND/OR. Each rule targets a
 * standard lead column or a custom-property definition with a type-aware
 * operator. Shared verbatim by the Convex query args (server-side matching) and
 * the frontend builder UI, so there is a single source of truth for the shape.
 */

/** Standard (built-in) lead columns that can be filtered in the builder. */
export const standardFieldValidator = v.union(
  v.literal('firstName'),
  v.literal('lastName'),
  v.literal('email'),
  v.literal('phone'),
  v.literal('comment'),
  v.literal('status'),
  v.literal('lifecycleStage'),
  v.literal('assignedTo'),
  v.literal('isRedFlagged'),
  v.literal('marketingConsent'),
);

/** A rule's target: either a standard column or a custom-property definition. */
export const filterFieldValidator = v.union(
  v.object({ kind: v.literal('standard'), field: standardFieldValidator }),
  v.object({ kind: v.literal('custom'), definitionId: v.string() }),
);

/**
 * Comparison operator. `equals`/`contains` cover text & option membership;
 * `isEmpty`/`isNotEmpty` test presence; `gt`/`lt`/`between` order numbers &
 * dates. Which operators a field offers is decided by {@link operatorsForType}.
 */
export const filterOperatorValidator = v.union(
  v.literal('equals'),
  v.literal('contains'),
  v.literal('isEmpty'),
  v.literal('isNotEmpty'),
  v.literal('gt'),
  v.literal('lt'),
  v.literal('between'),
);

/** Inclusive bounds for the `between` operator (numbers or ISO date strings). */
export const filterRangeValidator = v.object({
  min: v.optional(v.union(v.number(), v.string())),
  max: v.optional(v.union(v.number(), v.string())),
});

/**
 * A rule's value. Scalar for equals/contains/gt/lt (string | number | boolean),
 * a string[] for "is one of" / option membership, or a range for `between`.
 * Absent for isEmpty/isNotEmpty.
 */
export const filterRuleValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
  filterRangeValidator,
);

export const filterRuleValidator = v.object({
  field: filterFieldValidator,
  operator: filterOperatorValidator,
  value: v.optional(filterRuleValueValidator),
});

export const filterCombinatorValidator = v.union(v.literal('and'), v.literal('or'));

export const filterGroupValidator = v.object({
  combinator: filterCombinatorValidator,
  rules: v.array(filterRuleValidator),
});

export const advancedFilterValidator = v.object({
  combinator: filterCombinatorValidator,
  groups: v.array(filterGroupValidator),
});

export type StandardField = Infer<typeof standardFieldValidator>;
export type FilterField = Infer<typeof filterFieldValidator>;
export type FilterOperator = Infer<typeof filterOperatorValidator>;
export type FilterRange = Infer<typeof filterRangeValidator>;
export type FilterRuleValue = Infer<typeof filterRuleValueValidator>;
export type FilterRule = Infer<typeof filterRuleValidator>;
export type FilterCombinator = Infer<typeof filterCombinatorValidator>;
export type FilterGroup = Infer<typeof filterGroupValidator>;
export type AdvancedFilter = Infer<typeof advancedFilterValidator>;

/**
 * Unified "type" a rule's field resolves to, spanning custom-property types and
 * the special standard fields (`status`, `lifecycle`, `assignee`). Drives which operators and
 * which value input the builder shows. `select` covers both select and radio.
 */
export type FilterFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'date'
  | 'select'
  | 'checkbox'
  | 'boolean'
  | 'status'
  | 'lifecycle'
  | 'assignee';

/**
 * The operators offered for a field type. Pure and dependency-free so the UI
 * (operator dropdown) and any server-side use agree. The first entry is the
 * sensible default when a field is first picked.
 */
export function operatorsForType(type: FilterFieldType): FilterOperator[] {
  switch (type) {
    case 'text':
    case 'email':
      return ['contains', 'equals', 'isEmpty', 'isNotEmpty'];
    case 'number':
      return ['equals', 'gt', 'lt', 'between', 'isEmpty', 'isNotEmpty'];
    case 'date':
      return ['equals', 'gt', 'lt', 'between', 'isEmpty', 'isNotEmpty'];
    case 'select':
      return ['equals', 'isEmpty', 'isNotEmpty'];
    case 'checkbox':
      return ['contains', 'isEmpty', 'isNotEmpty'];
    case 'boolean':
      return ['equals'];
    case 'status':
      return ['equals'];
    case 'lifecycle':
      return ['equals', 'isEmpty', 'isNotEmpty'];
    case 'assignee':
      return ['equals', 'isEmpty', 'isNotEmpty'];
  }
}

/**
 * Whether a rule is "complete" enough to affect matching. Incomplete rules
 * (operator that needs a value but has none) are ignored during evaluation so a
 * half-built builder never hides every row, and are excluded from the active
 * count shown in the UI. `isEmpty`/`isNotEmpty` need no value and are always
 * active. Pure & shared by the server matcher and the UI counter.
 */
export function isActiveRule(rule: FilterRule): boolean {
  switch (rule.operator) {
    case 'isEmpty':
    case 'isNotEmpty':
      return true;
    case 'between': {
      const val = rule.value;
      if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
      return val.min !== undefined || val.max !== undefined;
    }
    default: {
      const val = rule.value;
      if (val === undefined || val === null || val === '') return false;
      if (Array.isArray(val)) return val.length > 0;
      return true;
    }
  }
}
