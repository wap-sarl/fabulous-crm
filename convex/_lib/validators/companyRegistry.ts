import { checkVAT, countries as jsvatCountries } from 'jsvat';

export interface RegistrationScheme {
  /** Stable scheme id ('siret', 'generic', …). */
  id: string;
  /** Field label in the forms, e.g. "SIRET". */
  label: string;
  /** Input hint, e.g. "XXX XXX XXX XXXXX". */
  placeholder?: string;
  /** Canonical stored form of a raw user/CSV value. */
  normalize: (raw: string) => string;
  /** French error for an invalid normalized value, or null when valid. */
  validate: (normalized: string) => string | null;
}

/** Luhn checksum, as used by SIREN/SIRET. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// La Poste's SIREN is the documented exception to the SIRET Luhn rule: its
// establishments validate when the plain digit sum is a multiple of 5.
const LA_POSTE_SIREN = '356000000';

/** France — SIREN (9 digits) or SIRET (14 digits), Luhn-checked. */
export const SIRET_SCHEME: RegistrationScheme = {
  id: 'siret',
  label: 'SIRET',
  placeholder: 'XXX XXX XXX XXXXX',
  normalize: (raw) => raw.replace(/\D/g, ''),
  validate: (digits) => {
    if (digits.length !== 9 && digits.length !== 14) {
      return 'Un SIREN comporte 9 chiffres, un SIRET 14.';
    }
    if (digits.length === 14 && digits.startsWith(LA_POSTE_SIREN)) {
      const sum = [...digits].reduce((n, d) => n + Number(d), 0);
      return sum % 5 === 0 ? null : 'Numéro SIRET invalide (clé de contrôle).';
    }
    return luhnValid(digits) ? null : 'Numéro SIRET invalide (clé de contrôle).';
  },
};

/** Fallback for countries without a dedicated scheme. */
export const GENERIC_REGISTRATION_SCHEME: RegistrationScheme = {
  id: 'generic',
  label: "Numéro d'immatriculation",
  normalize: (raw) => raw.trim(),
  validate: (value) => (value.length > 64 ? 'Numéro trop long (64 caractères max).' : null),
};

export const REGISTRATION_SCHEMES: Record<string, RegistrationScheme> = {
  FR: SIRET_SCHEME,
};

/** ISO-3166-1 alpha-2 codes: two letters, stored uppercase. */
export const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
export const DEFAULT_COUNTRY = 'FR';

export function normalizeCountryCode(raw: string | undefined): string {
  const code = (raw ?? '').trim().toUpperCase();
  return code || DEFAULT_COUNTRY;
}

/** The scheme for a country (generic when none is registered). */
export function registrationSchemeFor(country: string | undefined): RegistrationScheme {
  return REGISTRATION_SCHEMES[normalizeCountryCode(country)] ?? GENERIC_REGISTRATION_SCHEME;
}

/** EU member states — VAT numbers can be checked live against VIES. */
export const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'XI',
]);

/** VIES uses EL for Greece and XI for Northern Ireland. */
export function viesCountryCode(country: string): string {
  return country === 'GR' ? 'EL' : country;
}

export interface VatScheme {
  id: string;
  label: string;
  placeholder?: string;
  normalize: (raw: string) => string;
  /** French error for an invalid normalized value (checksum, prefix…), or null. */
  validate: (normalized: string, country: string) => string | null;
  /** Whether a live registry check exists for this country (VIES). */
  lookup: boolean;
}

const jsvatByCountry = new Map(
  jsvatCountries.flatMap((c) => c.codes.map((code) => [code, c] as const)),
);

/** Countries whose VAT format (and checksum) jsvat knows — EU plus a few others. */
export function hasVatChecksum(country: string): boolean {
  return jsvatByCountry.has(normalizeCountryCode(country));
}

const VAT_PLACEHOLDERS: Record<string, string> = {
  FR: 'FR12345678901',
  BE: 'BE0123456789',
  DE: 'DE123456789',
  ES: 'ESA12345678',
  IT: 'IT12345678901',
  NL: 'NL123456789B01',
  LU: 'LU12345678',
  CH: 'CHE-123.456.789',
  GB: 'GB123456789',
};

/**
 * VAT number scheme for a country. Stored upper-cased without separators,
 * including the country prefix. Where jsvat knows the country, the number
 * must be a valid format AND checksum for THAT country (a Belgian number on a
 * French company is refused); elsewhere any short identifier is accepted.
 */
export function vatSchemeFor(country: string | undefined): VatScheme {
  const code = normalizeCountryCode(country);
  const known = jsvatByCountry.get(code);
  return {
    id: known ? 'jsvat' : 'generic',
    label: EU_COUNTRIES.has(code) ? 'N° de TVA intracommunautaire' : 'N° de TVA',
    placeholder: VAT_PLACEHOLDERS[code],
    normalize: (raw) => raw.replace(/[\s.-]/g, '').toUpperCase(),
    validate: (value) => {
      if (value.length > 32) return 'Numéro trop long (32 caractères max).';
      if (!known) return null;
      const result = checkVAT(value, [known]);
      if (result.isValid) return null;
      return result.isValidFormat
        ? 'Numéro de TVA invalide (clé de contrôle).'
        : `Numéro de TVA invalide pour ce pays (ex. ${VAT_PLACEHOLDERS[code] ?? known.name}).`;
    },
    lookup: EU_COUNTRIES.has(code),
  };
}
