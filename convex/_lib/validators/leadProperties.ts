import { Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';

/**
 * The kind of a custom lead property. Drives which input renders in the lead
 * form, how the value is displayed, and whether the property is filterable
 * (`select`, `radio`, `checkbox`, `boolean`). `date` values are stored as
 * `'YYYY-MM-DD'` strings and `checkbox` as a `string[]` (see
 * leadPropertyValueValidator). `radio` is a single choice (same string data as
 * `select`); `checkbox` is a multiple choice.
 */
export const leadPropertyTypeValidator = v.union(
  v.literal('text'),
  v.literal('number'),
  v.literal('email'),
  v.literal('select'),
  v.literal('radio'),
  v.literal('checkbox'),
  v.literal('date'),
  v.literal('boolean'),
  // French health-professional identifier. Value is the 11-digit RPPS string; the
  // lead form renders it with an FHIR-connected verified input (Annuaire Santé).
  v.literal('rpps')
);

/** Types whose value is chosen from an admin-defined `options` list. */
export const OPTION_BASED_TYPES: LeadPropertyType[] = ['select', 'radio', 'checkbox'];

/**
 * One choice of a `select`/`radio`/`checkbox` property. `value` is a stable slug
 * stored on the lead — it must never change once created (renaming edits only
 * `label`), so existing lead values keep resolving. `label` is the human-facing text.
 */
export const leadPropertyOptionValidator = v.object({
  value: v.string(),
  label: v.string(),
});

/**
 * A stored custom-property value on a lead. Covers every property type:
 * text/email/select/radio/date → string ('YYYY-MM-DD' for date), number → number,
 * boolean → boolean, checkbox → string[] (option values).
 */
export const leadPropertyValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string())
);

/**
 * Optional validation rules on a definition. `min`/`max` bound a `number`;
 * `minLength`/`maxLength`/`pattern` (a regex source) constrain `text`. `email`
 * validates its format intrinsically and carries no config. Unset ⇒ no rule.
 */
export const leadPropertyValidationValidator = v.object({
  min: v.optional(v.number()),
  max: v.optional(v.number()),
  minLength: v.optional(v.number()),
  maxLength: v.optional(v.number()),
  pattern: v.optional(v.string()),
});

/**
 * Admin-defined custom property attached to leads. A soft-deletable, ordered
 * entity (same pattern as leads/campaigns). Lead values key off this doc's
 * stable `_id`. `type` is immutable after creation (change = delete + recreate).
 */
export const leadPropertyDefinitionValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  label: v.string(),
  type: leadPropertyTypeValidator,
  // Required for option-based types (select/radio/checkbox); unset otherwise.
  options: v.optional(v.array(leadPropertyOptionValidator)),
  // Type-appropriate validation rules (number range / text length+pattern).
  validation: v.optional(leadPropertyValidationValidator),
  // When true, the property renders as a column in the leads table.
  showInTable: v.boolean(),
  // Display order in the form/table/settings; sorted with `sortByOrder`.
  order: v.optional(v.number()),
});

export type LeadPropertyType = Infer<typeof leadPropertyTypeValidator>;
export type LeadPropertyOption = Infer<typeof leadPropertyOptionValidator>;
export type LeadPropertyValue = Infer<typeof leadPropertyValueValidator>;
export type LeadPropertyValidation = Infer<typeof leadPropertyValidationValidator>;
export type LeadPropertyDefinition = Infer<typeof leadPropertyDefinitionValidator>;

/**
 * Placeholder param key for a custom property ({{ params.custom_<defId> }}).
 * Convex ids are alphanumeric, so the key always matches the `[\w]+` capture
 * of renderPlaceholders; keying by _id survives label renames and collisions.
 */
export function customPropertyParamKey(defId: string): string {
  return `custom_${defId}`;
}

/**
 * Format a stored custom-property value as the string substituted into
 * campaign messages. Option-based types render their human labels; unset
 * values render as ''. Pure and dependency-free (shared with the frontend).
 */
export function formatLeadPropertyParamValue(
  def: Pick<LeadPropertyDefinition, 'type' | 'options'>,
  value: LeadPropertyValue | undefined
): string {
  if (value === undefined || value === null || value === '') return '';

  const optionLabel = (raw: string) =>
    def.options?.find((o) => o.value === raw)?.label ?? raw;

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
  type: LeadPropertyType;
  validation?: LeadPropertyValidation;
};

// Pragmatic, widely-compatible email check (mirrors the frontend zEmailSchema intent).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a single custom-property value against its definition's type +
 * validation rules. Returns a French error message, or `null` when valid.
 * Empty/unset values are always valid (there is no "required" rule). Pure and
 * dependency-free so it is shared by the lead form (inline errors) and the
 * create/update mutation (server enforcement).
 */
export function validateLeadPropertyValue(
  def: ValidatableDefinition,
  value: LeadPropertyValue | undefined
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
