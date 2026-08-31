import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

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

  const patch: Partial<Doc<'leads'>> = {};
  if ((lead.lastActivityAt ?? 0) < at) patch.lastActivityAt = at;
  if (kind !== 'activity') {
    const { lastField, countField } = SIGNAL_COLUMNS[kind];
    patch[countField] = (lead[countField] ?? 0) + 1;
    if ((lead[lastField] ?? 0) < at) patch[lastField] = at;
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
}
