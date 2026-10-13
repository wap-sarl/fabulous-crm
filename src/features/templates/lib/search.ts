/** The templates a search reaches: the name, the subject or the category holds the text, case and accents aside. */
export function filterTemplates<T extends { name: string; subject: string; category?: string }>(
  templates: T[],
  search: string,
  category?: string,
): T[] {
  const q = fold(search);
  return templates.filter(
    (t) =>
      (category === undefined || (t.category ?? '') === category) &&
      (!q || [t.name, t.subject, t.category ?? ''].some((v) => fold(v).includes(q))),
  );
}

/** The categories in use, in alphabetical order; the empty one is left out. */
export function categoriesOf<T extends { category?: string }>(templates: T[]): string[] {
  return [...new Set(templates.map((t) => t.category).filter((c): c is string => !!c))].sort(
    (a, b) => a.localeCompare(b, 'fr'),
  );
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
