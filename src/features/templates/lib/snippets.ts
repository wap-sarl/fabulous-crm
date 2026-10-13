const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A snippet's text as the editor inserts it: one line goes inline, several become paragraphs. */
export function snippetHtml(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (lines.length === 1) return escapeHtml(lines[0]);
  return lines.map((line) => `<p>${line ? escapeHtml(line) : '<br>'}</p>`).join('');
}

/** The snippets the typed query reaches: those whose shortcut or name starts with it, shortcut first; all of them on an empty query. */
export function matchSnippets<S extends { name: string; shortcut: string }>(
  snippets: S[],
  query: string,
): S[] {
  const q = query.trim().toLowerCase().replace(/^\//, '');
  if (!q) return snippets;
  const byShortcut = snippets.filter((s) => s.shortcut.slice(1).startsWith(q));
  const byName = snippets.filter(
    (s) => !byShortcut.includes(s) && s.name.toLowerCase().startsWith(q),
  );
  return [...byShortcut, ...byName];
}
