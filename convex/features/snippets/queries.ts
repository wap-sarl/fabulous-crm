import { v } from 'convex/values';
import { employeeQuery } from '../../_lib/auth';

/** Every snippet, by shortcut: the editor's slash menu and the settings read the same list. */
export const listSnippets = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id('snippets'),
      name: v.string(),
      shortcut: v.string(),
      text: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query('snippets').withIndex('by_shortcut').collect();
    return rows.map((row) => ({
      _id: row._id,
      name: row.name,
      shortcut: row.shortcut,
      text: row.text,
    }));
  },
});
