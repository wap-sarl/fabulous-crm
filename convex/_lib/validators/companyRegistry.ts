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
