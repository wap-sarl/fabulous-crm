import { getCountries } from 'libphonenumber-js';

/** ISO-3166-1 alpha-2 codes with French display names, France first then A→Z. */
export const COUNTRIES: { code: string; name: string }[] = (() => {
  const names = new Intl.DisplayNames(['fr'], { type: 'region' });
  const list = getCountries()
    .map((code) => ({ code: code as string, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const fr = list.find((c) => c.code === 'FR');
  return fr ? [fr, ...list.filter((c) => c.code !== 'FR')] : list;
})();

const NAME_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]));

export function countryName(code: string | undefined): string {
  return code ? (NAME_BY_CODE.get(code) ?? code) : '—';
}
