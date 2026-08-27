import type { PropertyOption, PropertyValidation, PropertyValue } from './properties';

/**
 * Backend registry of the custom-property types: one descriptor per type,
 * holding everything the server needs to know about it. `propertyTypeValidator`
 * is derived from {@link PROPERTY_TYPE_KEYS}, and `Record<PropertyType, …>`
 * makes a missing descriptor a type error. Pure and dependency-free: shared
 * with the frontend (labels, inputs, formatters live in
 * `src/features/properties/lib/propertyTypes.tsx`, keyed the same way).
 *
 * Adding a type = one key here + one descriptor here + one descriptor there.
 */
export const PROPERTY_TYPE_KEYS = [
  'text',
  'number',
  'email',
  'select',
  'radio',
  'checkbox',
  'date',
  'boolean',
  'rpps',
] as const;
export type PropertyTypeKey = (typeof PROPERTY_TYPE_KEYS)[number];

export type PropertyRuleKey = keyof PropertyValidation;

export interface PropertyTypeDescriptor {
  /** Validation rule keys the type supports (settings dialog + mutation cleaning). */
  rules: readonly PropertyRuleKey[];
  /** The value is chosen from the definition's `options`. */
  optionBased: boolean;
  /**
   * The stored shape: returns the cleaned value, or `undefined` to drop a
   * malformed / empty one. Runs before `validate`.
   */
  sanitize: (value: unknown, def: { options?: PropertyOption[] }) => PropertyValue | undefined;
  /** Rule and format checks on a sanitized, non-empty value; French message or null. */
  validate: (value: PropertyValue, rules: PropertyValidation) => string | null;
  /** Merge-param rendering ({{ params.custom_<id> }}) of a non-empty value. */
  formatParam: (value: PropertyValue, def: { options?: PropertyOption[] }) => string;
}

// Pragmatic, widely-compatible email check (mirrors the frontend zEmailSchema intent).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const optionLabel = (def: { options?: PropertyOption[] }, raw: string) =>
  def.options?.find((o) => o.value === raw)?.label ?? raw;

const optionValue = (value: unknown, def: { options?: PropertyOption[] }): string | undefined =>
  typeof value === 'string' && (def.options ?? []).some((o) => o.value === value)
    ? value
    : undefined;

const asString = (value: PropertyValue): string =>
  Array.isArray(value) ? value.join(', ') : String(value);

const textRules = (value: PropertyValue, rules: PropertyValidation): string | null => {
  if (typeof value !== 'string') return 'Valeur invalide.';
  if (rules.minLength !== undefined && value.length < rules.minLength)
    return `Au moins ${rules.minLength} caractère(s) requis.`;
  if (rules.maxLength !== undefined && value.length > rules.maxLength)
    return `Au plus ${rules.maxLength} caractère(s) autorisé(s).`;
  if (rules.pattern) {
    try {
      if (!new RegExp(rules.pattern).test(value)) return 'Format invalide.';
    } catch {
      // An invalid stored pattern never blocks a value.
    }
  }
  return null;
};

export const PROPERTY_TYPES: Record<PropertyTypeKey, PropertyTypeDescriptor> = {
  text: {
    rules: ['minLength', 'maxLength', 'pattern'],
    optionBased: false,
    sanitize: nonEmptyString,
    validate: textRules,
    formatParam: asString,
  },
  number: {
    rules: ['min', 'max'],
    optionBased: false,
    sanitize: (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
    validate: (value, rules) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Nombre invalide.';
      if (rules.min !== undefined && value < rules.min)
        return `La valeur doit être supérieure ou égale à ${rules.min}.`;
      if (rules.max !== undefined && value > rules.max)
        return `La valeur doit être inférieure ou égale à ${rules.max}.`;
      return null;
    },
    formatParam: asString,
  },
  email: {
    rules: [],
    optionBased: false,
    sanitize: nonEmptyString,
    validate: (value) =>
      typeof value !== 'string' || !EMAIL_RE.test(value) ? 'Adresse e-mail invalide.' : null,
    formatParam: asString,
  },
  select: {
    rules: [],
    optionBased: true,
    sanitize: optionValue,
    validate: () => null,
    formatParam: (value, def) =>
      typeof value === 'string' ? optionLabel(def, value) : asString(value),
  },
  radio: {
    rules: [],
    optionBased: true,
    sanitize: optionValue,
    validate: () => null,
    formatParam: (value, def) =>
      typeof value === 'string' ? optionLabel(def, value) : asString(value),
  },
  checkbox: {
    rules: [],
    optionBased: true,
    sanitize: (value, def) => {
      if (!Array.isArray(value)) return undefined;
      const picked = value.filter((v): v is string => optionValue(v, def) !== undefined);
      return picked.length > 0 ? picked : undefined;
    },
    validate: () => null,
    formatParam: (value, def) =>
      Array.isArray(value) ? value.map((v) => optionLabel(def, v)).join(', ') : asString(value),
  },
  date: {
    rules: [],
    optionBased: false,
    // Stored as 'YYYY-MM-DD'.
    sanitize: nonEmptyString,
    validate: () => null,
    formatParam: (value) => {
      const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : asString(value);
    },
  },
  boolean: {
    rules: [],
    optionBased: false,
    sanitize: (value) => (typeof value === 'boolean' ? value : undefined),
    validate: () => null,
    formatParam: (value) => (value === true ? 'oui' : 'non'),
  },
  rpps: {
    rules: [],
    optionBased: false,
    // French health-professional identifier: the 11-digit RPPS string.
    sanitize: nonEmptyString,
    validate: (value) => {
      if (typeof value !== 'string') return 'Valeur invalide.';
      const digits = value.replace(/\D/g, '');
      return digits.length !== 11 || digits[0] !== '1'
        ? 'Numéro RPPS invalide (11 chiffres, commence par 1).'
        : null;
    },
    formatParam: asString,
  },
};

export function propertyTypeDescriptor(type: PropertyTypeKey): PropertyTypeDescriptor {
  return PROPERTY_TYPES[type];
}
