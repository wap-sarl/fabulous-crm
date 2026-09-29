/** A text as its ASCII words, lowercase and without accents, joined by `separator` (« Équipe Nord » → `equipe-nord`). */
export function slugOf(text: string, separator = '-'): string {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]+/g);
  return words ? words.join(separator) : '';
}
