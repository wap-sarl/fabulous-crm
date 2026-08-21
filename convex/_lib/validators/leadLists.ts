import { type Infer, v } from 'convex/values';
import { logsValidator } from './shared';

/**
 * A named grouping of leads, typically created by a CSV import. `createdBy`
 * (from logsValidator) is the importer; `_creationTime` is the import date.
 * Membership is stored in the `leadListMembers` junction — a lead can belong to
 * many lists. The list itself is hard-deleted (it's just a grouping); its member
 * leads are only removed on an explicit cascade.
 */
export const leadListValidator = v.object({
  ...logsValidator.fields,
  name: v.string(),
});

/** Junction row linking a lead to a list, with the employee who added it. */
export const leadListMemberValidator = v.object({
  listId: v.id('leadLists'),
  leadId: v.id('leads'),
  addedBy: v.id('users'),
});

export type LeadList = Infer<typeof leadListValidator>;
export type LeadListMember = Infer<typeof leadListMemberValidator>;
