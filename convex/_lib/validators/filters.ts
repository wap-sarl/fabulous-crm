import { type Infer, v, type Validator } from 'convex/values';

/** Built-in lead columns that can be filtered in the builder. */
export const leadStandardFieldValidator = v.union(
  v.literal('firstName'),
  v.literal('lastName'),
  v.literal('email'),
  v.literal('phone'),
  v.literal('comment'),
  v.literal('lifecycleStage'),
  v.literal('ownerIds'),
  v.literal('isRedFlagged'),
  v.literal('marketingConsent'),
  v.literal('companyId'),
  v.literal('createdAt'),
  v.literal('leadScore'),
  v.literal('lastActivityAt'),
  v.literal('lastEmailOpenAt'),
  v.literal('emailOpenCount'),
  v.literal('lastEmailClickAt'),
  v.literal('emailClickCount'),
  v.literal('lastFormSubmissionAt'),
  v.literal('formSubmissionCount'),
  v.literal('lastPageViewAt'),
  v.literal('pageViewCount'),
  // List membership, resolved through the by_list_lead index at eval time.
  v.literal('listIds'),
);

/** Built-in company columns that can be filtered in the builder. */
export const companyStandardFieldValidator = v.union(
  v.literal('name'),
  v.literal('domain'),
  v.literal('country'),
  v.literal('website'),
  v.literal('sector'),
  v.literal('headcount'),
  v.literal('createdAt'),
);

/** Built-in deal columns that can be filtered in the builder. */
export const dealStandardFieldValidator = v.union(
  v.literal('title'),
  v.literal('amount'),
  v.literal('currency'),
  v.literal('status'),
  v.literal('stageKey'),
  v.literal('stageTags'),
  v.literal('ownerIds'),
  v.literal('expectedCloseDate'),
  v.literal('createdAt'),
);

/**
 * Comparison operator. `equals`/`notEquals`/`contains` cover text & option
 * membership; `isEmpty`/`isNotEmpty` test presence; `gt`/`lt`/`between` order
 * numbers & dates; `inLastDays`/`inNextDays`/`moreThanDaysAgo` compare a date
 * to now (value = whole days). Offered per type by {@link operatorsForType}.
 */
export const filterOperatorValidator = v.union(
  v.literal('equals'),
  v.literal('notEquals'),
  v.literal('contains'),
  v.literal('isEmpty'),
  v.literal('isNotEmpty'),
  v.literal('gt'),
  v.literal('lt'),
  v.literal('between'),
  v.literal('inLastDays'),
  v.literal('inNextDays'),
  v.literal('moreThanDaysAgo'),
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

export const filterCombinatorValidator = v.union(v.literal('and'), v.literal('or'));

/** The rule/group/filter validators for one entity's standard-field union. */
export function advancedFilterValidators<F extends Validator<string, 'required', never>>(
  standardField: F,
) {
  const filterField = v.union(
    v.object({ kind: v.literal('standard'), field: standardField }),
    v.object({ kind: v.literal('custom'), definitionId: v.string() }),
  );
  const filterRule = v.object({
    field: filterField,
    operator: filterOperatorValidator,
    value: v.optional(filterRuleValueValidator),
  });
  const filterGroup = v.object({
    combinator: filterCombinatorValidator,
    rules: v.array(filterRule),
  });
  const advancedFilter = v.object({
    combinator: filterCombinatorValidator,
    groups: v.array(filterGroup),
  });
  return { filterField, filterRule, filterGroup, advancedFilter };
}

export const leadFilterValidators = advancedFilterValidators(leadStandardFieldValidator);
export const companyFilterValidators = advancedFilterValidators(companyStandardFieldValidator);
export const dealFilterValidators = advancedFilterValidators(dealStandardFieldValidator);

export const leadAdvancedFilterValidator = leadFilterValidators.advancedFilter;
export const companyAdvancedFilterValidator = companyFilterValidators.advancedFilter;
export const dealAdvancedFilterValidator = dealFilterValidators.advancedFilter;

export type LeadStandardField = Infer<typeof leadStandardFieldValidator>;
export type CompanyStandardField = Infer<typeof companyStandardFieldValidator>;
export type DealStandardField = Infer<typeof dealStandardFieldValidator>;
export type FilterOperator = Infer<typeof filterOperatorValidator>;
export type FilterRange = Infer<typeof filterRangeValidator>;
export type FilterRuleValue = Infer<typeof filterRuleValueValidator>;
export type FilterCombinator = Infer<typeof filterCombinatorValidator>;

/** A rule's target: either a standard column or a custom-property definition. */
export type FilterField<F extends string = string> =
  | { kind: 'standard'; field: F }
  | { kind: 'custom'; definitionId: string };

export interface FilterRule<F extends string = string> {
  field: FilterField<F>;
  operator: FilterOperator;
  value?: FilterRuleValue;
}

export interface FilterGroup<F extends string = string> {
  combinator: FilterCombinator;
  rules: FilterRule<F>[];
}

export interface AdvancedFilter<F extends string = string> {
  combinator: FilterCombinator;
  groups: FilterGroup<F>[];
}

export type LeadAdvancedFilter = AdvancedFilter<LeadStandardField>;
export type CompanyAdvancedFilter = AdvancedFilter<CompanyStandardField>;
export type DealAdvancedFilter = AdvancedFilter<DealStandardField>;

/**
 * Unified "type" a rule's field resolves to, spanning custom-property types and
 * the special standard fields (`lifecycle`, `assignee`). Drives which operators and
 * which value input the builder shows. `select` covers both select and radio,
 * and every standard field whose values come from a fixed list (deal status,
 * pipeline stage, country…).
 */
export type FilterFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'date'
  | 'timestamp'
  | 'select'
  | 'checkbox'
  | 'boolean'
  | 'lifecycle'
  | 'assignee'
  | 'list';

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
      return [
        'equals',
        'inLastDays',
        'inNextDays',
        'moreThanDaysAgo',
        'gt',
        'lt',
        'between',
        'isEmpty',
        'isNotEmpty',
      ];
    // Epoch-ms columns (creation, behavioural signals): always past-dated.
    case 'timestamp':
      return ['inLastDays', 'moreThanDaysAgo', 'gt', 'lt', 'between', 'isEmpty', 'isNotEmpty'];
    case 'select':
      return ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];
    case 'checkbox':
      return ['contains', 'isEmpty', 'isNotEmpty'];
    case 'boolean':
      return ['equals'];
    case 'lifecycle':
      return ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];
    case 'assignee':
      return ['equals', 'notEquals', 'isEmpty', 'isNotEmpty'];
    case 'list':
      return ['equals', 'notEquals'];
  }
}

/** List ids referenced by `listIds` rules — the lists membership must be resolved for. */
export function advancedFilterListIds(filter: AdvancedFilter | undefined): string[] {
  if (!filter) return [];
  const ids = new Set<string>();
  for (const group of filter.groups) {
    for (const rule of group.rules) {
      if (rule.field.kind !== 'standard' || rule.field.field !== 'listIds') continue;
      if (typeof rule.value === 'string') ids.add(rule.value);
      else if (Array.isArray(rule.value)) for (const id of rule.value) ids.add(id);
    }
  }
  return [...ids];
}

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
