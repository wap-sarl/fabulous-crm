import { type Infer, v } from 'convex/values';
import { logsValidator } from './shared';
import {
  criteriaUsesRelativeDates,
  isActiveRule,
  leadAdvancedFilterValidator,
  type LeadAdvancedFilter,
} from './filters';

export { criteriaUsesRelativeDates };

/** Lists an org may run as dynamic ones, unless appConfig.lists raises/lowers it. */
export const DEFAULT_MAX_DYNAMIC_LISTS = 20;
export const MAX_DYNAMIC_LISTS_CEILING = 200;

export const leadListValidator = v.object({
  ...logsValidator.fields,
  name: v.string(),
  // Absent = static (every list predates the dynamic kind).
  kind: v.optional(v.union(v.literal('static'), v.literal('dynamic'))),
  criteria: v.optional(leadAdvancedFilterValidator),
  // In-flight full recalculation: `stamp` invalidates superseded page jobs,
  // `processed` feeds the UI progress. Absent = no recalculation running.
  recalc: v.optional(v.object({ stamp: v.number(), processed: v.number() })),
  lastRecalcAt: v.optional(v.number()),
  // Pending time-drift recalculation (criteria using relative dates), cancellable.
  nextRecalcId: v.optional(v.id('_scheduled_functions')),
});

/**
 * Junction row linking a lead to a list, with the employee who added it.
 * `addedBy` is absent when the dynamic-list engine added the row.
 */
export const leadListMemberValidator = v.object({
  listId: v.id('leadLists'),
  leadId: v.id('leads'),
  addedBy: v.optional(v.id('users')),
});

export type LeadList = Infer<typeof leadListValidator>;
export type LeadListMember = Infer<typeof leadListMemberValidator>;
export type LeadListKind = 'static' | 'dynamic';

export function validateDynamicListCriteria(
  criteria: LeadAdvancedFilter | undefined,
): string | null {
  const rules = criteria?.groups.flatMap((g) => g.rules) ?? [];
  if (!rules.some(isActiveRule)) return 'dynamic_list_criteria_required';
  const hasListRule = rules.some((r) => r.field.kind === 'standard' && r.field.field === 'listIds');
  return hasListRule ? 'dynamic_list_criteria_list_rule' : null;
}
