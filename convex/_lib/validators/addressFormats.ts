import { ADDRESS_FORMAT_DATA } from './addressFormats.generated';

export interface AddressFormatData {
  fmt?: string;
  /** Latin-script variant of `fmt` for countries whose local script isn't Latin. */
  lfmt?: string;
  /** Required field letters among A, C, S, Z (D, X ignored). */
  require?: string;
  /** Fields to upper-case when formatting (same letters). */
  upper?: string;
  /** Postal-code regex source (anchored by the validator). */
  zip?: string;
  /** One example postal code (placeholder). */
  zipex?: string;
  regionType?: string;
  cityType?: string;
  postalType?: string;
  /** Administrative areas as [key, display name], when the country enumerates them. */
  regions?: [string, string][];
}

/** Address fields the CRM edits, as libaddressinput letters. */
type AddressFieldKey = 'street' | 'city' | 'region' | 'postalCode';

interface AddressFieldSpec {
  key: AddressFieldKey;
  label: string;
  placeholder?: string;
  required: boolean;
  /** Present when the region must be picked from a list (US states, JP prefectures…). */
  options?: [string, string][];
}

export interface AddressFormat extends AddressFormatData {
  country: string;
  /** Fields in the country's writing order, `street` always first. */
  fields: AddressFieldSpec[];
}

const DEFAULT = ADDRESS_FORMAT_DATA.ZZ ?? { fmt: '%N%n%O%n%A%n%C', require: 'AC', upper: 'C' };

/** French labels for libaddressinput's field naming types. */
const REGION_LABELS: Record<string, string> = {
  area: 'Zone',
  county: 'Comté',
  department: 'Département',
  district: 'District',
  do_si: 'Do / Si',
  emirate: 'Émirat',
  island: 'Île',
  oblast: 'Oblast',
  parish: 'Paroisse',
  prefecture: 'Préfecture',
  province: 'Province',
  state: 'État',
};
const CITY_LABELS: Record<string, string> = {
  city: 'Ville',
  district: 'District',
  post_town: 'Ville postale',
  suburb: 'Quartier',
};
const POSTAL_LABELS: Record<string, string> = {
  postal: 'Code postal',
  zip: 'Code ZIP',
  eircode: 'Eircode',
  pin: 'Code PIN',
};

const LETTER_TO_KEY: Record<string, AddressFieldKey> = {
  A: 'street',
  C: 'city',
  S: 'region',
  Z: 'postalCode',
};

function normalizeCountry(country: string | undefined): string {
  return (country ?? '').trim().toUpperCase();
}

/** The raw metadata for a country, defaulting to libaddressinput's `ZZ` fallback. */
function addressFormatDataFor(country: string | undefined): AddressFormatData {
  return ADDRESS_FORMAT_DATA[normalizeCountry(country)] ?? DEFAULT;
}

/** A country without metadata gets the generic "street, city" layout; every country keeps an optional postal code so none a user has is lost. */
export function addressFormatFor(country: string | undefined): AddressFormat {
  const code = normalizeCountry(country);
  const data = addressFormatDataFor(code);
  const fmt = data.lfmt ?? data.fmt ?? DEFAULT.fmt ?? '%A%n%C';
  const required = new Set((data.require ?? DEFAULT.require ?? 'AC').split(''));

  const order: AddressFieldKey[] = [];
  for (const m of fmt.matchAll(/%([A-Z])/g)) {
    const key = LETTER_TO_KEY[m[1]];
    if (key && !order.includes(key)) order.push(key);
  }
  // The street block always leads the form, whatever the postal writing order.
  const keys: AddressFieldKey[] = ['street', ...order.filter((k) => k !== 'street')];
  if (!keys.includes('postalCode')) keys.push('postalCode');
  if (!keys.includes('city')) keys.push('city');

  const fields: AddressFieldSpec[] = keys.map((key) => {
    switch (key) {
      case 'street':
        return { key, label: 'Rue', required: required.has('A') };
      case 'city':
        return {
          key,
          label: CITY_LABELS[data.cityType ?? 'city'] ?? 'Ville',
          required: required.has('C'),
        };
      case 'region':
        return {
          key,
          label: REGION_LABELS[data.regionType ?? 'province'] ?? 'Région',
          required: required.has('S'),
          options: data.regions,
        };
      case 'postalCode':
        return {
          key,
          label: POSTAL_LABELS[data.postalType ?? 'postal'] ?? 'Code postal',
          placeholder: data.zipex,
          required: required.has('Z'),
        };
      default:
        throw new Error(`unknown address field ${key}`);
    }
  });
  return { ...data, country: code, fields };
}

/** The stored address shape this module reads. */
export interface FormattableAddress {
  country: string;
  streetNumber?: string;
  street: string;
  line2?: string;
  postalCode: string;
  city: string;
  region?: string;
}

/** Display name of a region key (falls back to the key). */
function regionLabel(country: string | undefined, region: string | undefined): string {
  if (!region) return '';
  const regions = addressFormatDataFor(country).regions;
  return regions?.find(([key]) => key === region)?.[1] ?? region;
}

/** The region as written on an envelope: the key when it is a postal abbreviation (US "CA"), the display name when the key is a code nobody writes (JP prefectures). */
function regionForPostal(country: string | undefined, region: string | undefined): string {
  if (!region) return '';
  return region.length <= 3 ? region : regionLabel(country, region);
}

/** The error is a French sentence shown to the user as is; the region is checked only when the country enumerates its regions. */
export function validateAddress(address: FormattableAddress): string | null {
  const format = addressFormatFor(address.country);
  if (!/^[A-Z]{2}$/.test(format.country)) return 'Pays invalide (code ISO à 2 lettres).';
  for (const field of format.fields) {
    const value = (address[field.key] ?? '').trim();
    if (field.required && !value) return `${field.label} : requis.`;
    if (!value) continue;
    if (field.key === 'postalCode' && format.zip) {
      const re = new RegExp(`^(?:${format.zip})$`, 'i');
      if (!re.test(value)) {
        return `${field.label} invalide${format.zipex ? ` (ex. ${format.zipex})` : ''}.`;
      }
    }
    if (field.key === 'region' && field.options && !field.options.some(([key]) => key === value)) {
      return `${field.label} : valeur inconnue pour ce pays.`;
    }
  }
  return null;
}

/** The lines follow the country's postal writing order and leave the country itself out; the fields its postal service wants in capitals are upper-cased. */
export function formatAddressLines(address: FormattableAddress): string[] {
  const data = addressFormatDataFor(address.country);
  const fmt = data.lfmt ?? data.fmt ?? DEFAULT.fmt ?? '%A%n%C';
  const upper = new Set((data.upper ?? '').split(''));
  const value = (letter: string): string => {
    let v = '';
    switch (letter) {
      case 'A':
        v = [address.streetNumber, address.street].filter(Boolean).join(' ');
        if (address.line2) v += `\n${address.line2}`;
        break;
      case 'C':
        v = address.city;
        break;
      case 'S':
        v = regionForPostal(address.country, address.region);
        break;
      case 'Z':
        v = address.postalCode;
        break;
      default:
        return '';
    }
    return upper.has(letter) ? v.toUpperCase() : v;
  };
  return fmt
    .split('%n')
    .map((line) =>
      line
        .replace(/%([A-Z])/g, (_, letter) => value(letter))
        .replace(/\s+,/g, ',')
        .replace(/[\s,]+$/g, '')
        .replace(/^[\s,]+/g, '')
        .trim(),
    )
    .flatMap((line) => line.split('\n'))
    .filter((line) => line.length > 0);
}

/** One-line address with the country name appended, for lists and merge params. */
export function formatAddressOneLine(
  address: FormattableAddress | undefined,
  countryName?: (code: string) => string,
): string {
  if (!address) return '';
  const lines = formatAddressLines(address);
  const country = countryName ? countryName(address.country) : address.country;
  return [...lines, country].filter(Boolean).join(', ');
}
