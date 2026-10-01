import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { computeChanges, logAudit, updateAuditFields } from '../audit/log';
import { isNotDeleted } from '../shared/db';

/** A note the system writes on a contact's timeline: it has no author. */
export async function insertSystemNote(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  content: string,
  at: number,
): Promise<void> {
  await ctx.db.insert('leadNotes', { leadId, content, isPinned: false, updatedAt: at });
}

/** The note an employee edits: the live one, else `note_not_found`. */
export async function liveNote(
  ctx: MutationCtx,
  noteId: Id<'leadNotes'>,
): Promise<Doc<'leadNotes'>> {
  const note = await ctx.db.get(noteId);
  if (!note || !isNotDeleted(note)) {
    throw new Error('note_not_found');
  }
  return note;
}

/** Write what an edit gives and audit what it changed. */
export async function editNote(
  ctx: MutationCtx,
  userId: Id<'users'>,
  note: Doc<'leadNotes'>,
  updates: { content: string } | { isPinned: boolean },
): Promise<Id<'leadNotes'>> {
  const changes = computeChanges(note, updates);
  await ctx.db.patch(note._id, { ...updates, ...updateAuditFields(userId) });

  if (changes) {
    await logAudit({
      ctx,
      userId,
      entityType: 'leadNote',
      entityId: note._id,
      action: 'update',
      metadata: { changes },
    });
  }

  return note._id;
}
