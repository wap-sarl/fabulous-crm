/** The formatters several screens share; one that a single screen uses stays with it. */
export const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
export const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const shortDateFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
});
export const numberFormat = new Intl.NumberFormat('fr-FR');
