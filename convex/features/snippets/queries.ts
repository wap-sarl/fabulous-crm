import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';

/** Every snippet, by shortcut: the editor's slash menu and the settings read the same list; `editable` tells whether the caller may change it. */
export const listSnippets = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('snippets'),
      name: v.string(),
      shortcut: v.string(),
      text: v.string(),
      ownerId: v.id('users'),
      editable: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query('snippets').withIndex('by_shortcut').collect();
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      shortcut: row.shortcut,
      text: row.text,
      ownerId: row.ownerId,
      editable: row.ownerId === ctx.userId || ctx.visibility.access.settings,
    }));
  },
});
