import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/** The campaign events that describe what the person did, not what the mail did; an objection to profiling drops them at the door. */
export const BEHAVIOURAL_CAMPAIGN_EVENTS = new Set(['opened', 'clicked', 'link_click']);

/** Right to object (RGPD): nothing about this person's behaviour is recorded, scored or acted on. */
export const profilingExcluded = (lead: { excludeFromProfiling?: boolean } | null): boolean =>
  lead?.excludeFromProfiling === true;

/** Engagement kinds that stamp the denormalized signal columns on the lead. */
export type LeadSignalKind =
  | 'email_open'
  | 'email_click'
  | 'form_submission'
  | 'page_view'
  | 'activity';

/** The last-seen / count column pair each engagement kind maintains. */
const SIGNAL_COLUMNS: Record<
  Exclude<LeadSignalKind, 'activity'>,
  {
    lastField: 'lastEmailOpenAt' | 'lastEmailClickAt' | 'lastFormSubmissionAt' | 'lastPageViewAt';
    countField: 'emailOpenCount' | 'emailClickCount' | 'formSubmissionCount' | 'pageViewCount';
  }
> = {
  email_open: { lastField: 'lastEmailOpenAt', countField: 'emailOpenCount' },
  email_click: { lastField: 'lastEmailClickAt', countField: 'emailClickCount' },
  form_submission: { lastField: 'lastFormSubmissionAt', countField: 'formSubmissionCount' },
  page_view: { lastField: 'lastPageViewAt', countField: 'pageViewCount' },
};

export async function stampLeadSignal(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  kind: LeadSignalKind,
  at: number,
): Promise<void> {
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.deletedAt !== undefined) return;
  // Second line behind the ingestion gates: no behavioural counters, the activity date alone is kept.
  const tracked = !profilingExcluded(lead);

  const patch: Partial<Doc<'leads'>> = {};
  if ((lead.lastActivityAt ?? 0) < at) patch.lastActivityAt = at;
  if (kind !== 'activity' && tracked) {
    const { lastField, countField } = SIGNAL_COLUMNS[kind];
    patch[countField] = (lead[countField] ?? 0) + 1;
    if ((lead[lastField] ?? 0) < at) patch[lastField] = at;
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
}
