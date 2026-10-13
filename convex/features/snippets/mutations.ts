import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { employeeMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import { follows } from '../../_lib/validators/fields';
import {
  snippetNameSchema,
  snippetShortcutSchema,
  snippetTextSchema,
} from '../../_lib/validators/emailTemplates';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit/log';

type Fields = { name: string; shortcut: string; text: string };

/** Each field within its bounds; a shortcut names one snippet. */
async function checkFields(
  ctx: MutationCtx,
  fields: Fields,
  self?: Id<'snippets'>,
): Promise<Fields> {
  if (!follows(snippetNameSchema, fields.name)) throw refusal('snippet_name_invalid');
  if (!follows(snippetShortcutSchema, fields.shortcut)) throw refusal('snippet_shortcut_invalid');
  if (!follows(snippetTextSchema, fields.text)) throw refusal('snippet_text_invalid');
  const shortcut = fields.shortcut.trim();
  const other = await ctx.db
    .query('snippets')
    .withIndex('by_shortcut', (q) => q.eq('shortcut', shortcut))
    .first();
  if (other && other._id !== self) throw refusal('snippet_shortcut_taken');
  return { name: fields.name.trim(), shortcut, text: fields.text.trim() };
}

const snippetArgs = { name: v.string(), shortcut: v.string(), text: v.string() };

/** The owner changes their snippet; the settings right changes any. */
async function loadEditable(
  ctx: MutationCtx & { userId: Id<'users'>; visibility: { access: { settings: boolean } } },
  snippetId: Id<'snippets'>,
): Promise<Doc<'snippets'>> {
  const snippet = await ctx.db.get(snippetId);
  if (!snippet) throw refusal('snippet_not_found');
  if (snippet.ownerId !== ctx.userId && !ctx.visibility.access.settings) {
    throw refusal('snippet_forbidden');
  }
  return snippet;
}

export const createSnippet = employeeMutation({
  args: snippetArgs,
  returns: v.id('snippets'),
  handler: async (ctx, args) => {
    const fields = await checkFields(ctx, args);
    const snippetId = await ctx.db.insert('snippets', {
      ...fields,
      ownerId: ctx.userId,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'snippet',
      entityId: snippetId,
      action: 'create',
      metadata: { shortcut: fields.shortcut },
    });
    return snippetId;
  },
});

export const updateSnippet = employeeMutation({
  args: { snippetId: v.id('snippets'), ...snippetArgs },
  returns: v.null(),
  handler: async (ctx, args) => {
    await loadEditable(ctx, args.snippetId);
    const fields = await checkFields(ctx, args, args.snippetId);
    await ctx.db.patch(args.snippetId, { ...fields, ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'snippet',
      entityId: args.snippetId,
      action: 'update',
      metadata: { shortcut: fields.shortcut },
    });
    return null;
  },
});

export const deleteSnippet = employeeMutation({
  args: { snippetId: v.id('snippets') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snippet = await loadEditable(ctx, args.snippetId);
    await ctx.db.delete(args.snippetId);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'snippet',
      entityId: args.snippetId,
      action: 'delete',
      metadata: { shortcut: snippet.shortcut },
    });
    return null;
  },
});
