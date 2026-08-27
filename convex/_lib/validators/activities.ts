import { type Infer, v } from 'convex/values';
import { customPropertiesValidator } from './properties';
import { logsValidator, softDeleteValidator } from './shared';

export const activityTypeValidator = v.union(
  v.literal('call'),
  v.literal('meeting'),
  v.literal('task'),
  v.literal('email'),
  v.literal('note'),
);
export type ActivityType = Infer<typeof activityTypeValidator>;

export const activityStatusValidator = v.union(
  v.literal('open'),
  v.literal('done'),
  v.literal('cancelled'),
);
export type ActivityStatus = Infer<typeof activityStatusValidator>;

export const activityValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  type: activityTypeValidator,
  title: v.string(),
  description: v.optional(v.string()),
  // Planned date/time (ms). Unset = no deadline (a note, an undated to-do).
  dueAt: v.optional(v.number()),
  status: activityStatusValidator,
  ownerId: v.id('users'),
  // Linked records; any combination, usually at least one.
  leadId: v.optional(v.id('leads')),
  companyId: v.optional(v.id('companies')),
  dealId: v.optional(v.id('deals')),
  // What came out of it (call result, meeting notes…), recorded at completion.
  outcome: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  // Admin-defined custom property values, keyed by propertyDefinitions._id.
  customProperties: customPropertiesValidator,
});
export type Activity = Infer<typeof activityValidator>;

/** Sort key of the owner aggregate: undated activities sit at 0, before any date. */
export const UNDATED_KEY = 0;
export const activityDueKey = (activity: Pick<Activity, 'dueAt'>): number =>
  activity.dueAt ?? UNDATED_KEY;
