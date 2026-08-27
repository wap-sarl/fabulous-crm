import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';

export const PROPERTY_ENTITY_TYPES = ['lead', 'company', 'deal', 'activity'] as const;

export const propertyEntityTypeValidator = v.union(
  v.literal('lead'),
  v.literal('company'),
  v.literal('deal'),
  v.literal('activity'),
);

export const propertyTypeValidator = v.union(
  v.literal('text'),
  v.literal('number'),
  v.literal('email'),
  v.literal('select'),
  v.literal('radio'),
  v.literal('checkbox'),
  v.literal('date'),
  v.literal('boolean'),
  v.literal('rpps'),
);

/** Types whose value is chosen from an admin-defined `options` list. */
export const OPTION_BASED_TYPES: PropertyType[] = ['select', 'radio', 'checkbox'];

export const propertyOptionValidator = v.object({
  value: v.string(),
  label: v.string(),
});

export const propertyValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
);

/** The `customProperties` field shared by every entity that carries custom properties. */
export const customPropertiesValidator = v.optional(v.record(v.string(), propertyValueValidator));

export const propertyValidationValidator = v.object({
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  minLength: v.optional(v.number()),
  maxLength: v.optional(v.number()),
  pattern: v.optional(v.string()),
});

export const propertyDefinitionValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  entityType: propertyEntityTypeValidator,
  label: v.string(),
  type: propertyTypeValidator,
  // Required for option-based types (select/radio/checkbox); unset otherwise.
  options: v.optional(v.array(propertyOptionValidator)),
  // Type-appropriate validation rules (number range / text length+pattern).
  validation: v.optional(propertyValidationValidator),
  // When true, the property renders as a column in the entity's list.
  showInTable: v.boolean(),
  // Display order in the form/table/settings, per entity type; sorted with `sortByOrder`.
  order: v.optional(v.number()),
  // Read-only, engine-maintained value (see above).
  computed: v.optional(v.literal(true)),
});

export type PropertyEntityType = Infer<typeof propertyEntityTypeValidator>;
export type PropertyType = Infer<typeof propertyTypeValidator>;
export type PropertyOption = Infer<typeof propertyOptionValidator>;
export type PropertyValue = Infer<typeof propertyValueValidator>;
export type PropertyValidation = Infer<typeof propertyValidationValidator>;
export type PropertyDefinition = Infer<typeof propertyDefinitionValidator>;

export function customPropertyParamKey(defId: string): string {
  return `custom_${defId}`;
}

export function formatPropertyParamValue(
  def: Pick<PropertyDefinition, 'type' | 'options'>,
  value: PropertyValue | undefined,
): string {
  if (value === undefined || value === null || value === '') return '';

  const optionLabel = (raw: string) => def.options?.find((o) => o.value === raw)?.label ?? raw;

  switch (def.type) {
    case 'boolean':
      return value === true ? 'oui' : 'non';
    case 'select':
    case 'radio':
      return typeof value === 'string' ? optionLabel(value) : String(value);
    case 'checkbox':
      return Array.isArray(value) ? value.map(optionLabel).join(', ') : String(value);
    case 'date': {
      // Stored as 'YYYY-MM-DD'; render French dd/MM/yyyy.
      const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
    }
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/** Minimal shape needed to validate a value — a full definition satisfies it. */
type ValidatableDefinition = {
  type: PropertyType;
  validation?: PropertyValidation;
};

// Pragmatic, widely-compatible email check (mirrors the frontend zEmailSchema intent).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePropertyValue(
  def: ValidatableDefinition,
  value: PropertyValue | undefined,
): string | null {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0);
  if (isEmpty) return null;

  const rules = def.validation ?? {};

  switch (def.type) {
    case 'email':
      if (typeof value !== 'string' || !EMAIL_RE.test(value)) return 'Adresse e-mail invalide.';
      return null;

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Nombre invalide.';
      if (rules.min !== undefined && value < rules.min)
        return `La valeur doit être supérieure ou égale à ${rules.min}.`;
      if (rules.max !== undefined && value > rules.max)
        return `La valeur doit être inférieure ou égale à ${rules.max}.`;
      return null;
    }

    case 'rpps': {
      if (typeof value !== 'string') return 'Valeur invalide.';
      const digits = value.replace(/\D/g, '');
      if (digits.length !== 11 || digits[0] !== '1')
        return 'Numéro RPPS invalide (11 chiffres, commence par 1).';
      return null;
    }

    case 'text': {
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
    }

    default:
      return null;
  }
}
