import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

/** A note the system writes on a contact's timeline: it has no author. */
export async function insertSystemNote(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  content: string,
  at: number,
): Promise<void> {
  await ctx.db.insert('leadNotes', { leadId, content, isPinned: false, updatedAt: at });
}
