/** Default name for a freshly created import list, e.g. « Import du 14 juillet 2026 à 16h ». */
export function defaultListName(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return `Import du ${date} à ${now.getHours()}h`;
}
