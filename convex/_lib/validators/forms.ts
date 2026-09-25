import { type Infer, v } from 'convex/values';
import { logsValidator, softDeleteValidator } from './shared';
import { propertyValueValidator } from './properties';

export const MAX_FORM_FIELDS = 20;
/** A submission younger than this since the form was served is treated as a bot. */
export const MIN_FILL_MS = 3_000;
/** And one older than this re-fetches the form (stale `ts` guard). */
export const MAX_FILL_MS = 24 * 60 * 60 * 1000;
export const FORM_VISITOR_TOKEN_BYTES = 24;

/** Built-in lead columns a capture form can ask for. */
export const FORM_STANDARD_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'company',
  'comment',
] as const;
export type FormStandardField = (typeof FORM_STANDARD_FIELDS)[number];

export const formStandardFieldValidator = v.union(
  v.literal('firstName'),
  v.literal('lastName'),
  v.literal('email'),
  v.literal('phone'),
  v.literal('company'),
  v.literal('comment'),
);

/** What a form field writes to: a built-in lead column or a custom property. */
export const formFieldTargetValidator = v.union(
  v.object({ kind: v.literal('standard'), field: formStandardFieldValidator }),
  v.object({ kind: v.literal('custom'), propertyDefId: v.id('propertyDefinitions') }),
);

/** One input of the form. Display order is the array order. */
/** A field as the builder sends it; the server gives it its public key. */
export const formFieldInputValidator = v.object({
  target: formFieldTargetValidator,
  label: v.string(),
  required: v.boolean(),
  key: v.optional(v.string()),
});

/** A field as stored: `key` is what the public definition and the submissions use, a slug of the label, unique in the form. */
export const formFieldValidator = v.object({
  target: formFieldTargetValidator,
  label: v.string(),
  required: v.boolean(),
  key: v.string(),
});

const FIELD_KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** A public key for a field: its label as an ASCII slug (« Prénom » → `prenom`). */
export function slugifyFieldKey(label: string): string {
  const slug = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'champ';
}

/**
 * Keys for the fields of a form about to be saved: a field keeps the key it had for the same target, so
 * stored submissions stay readable; a new one gets its label's slug, suffixed until unique.
 */
export function assignFieldKeys<F extends { target: FormFieldTarget; label: string }>(
  fields: F[],
  previous: { target: FormFieldTarget; key: string }[] = [],
): (F & { key: string })[] {
  const kept = new Map(previous.map((f) => [formFieldKey(f.target), f.key]));
  const used = new Set<string>();
  return fields.map((field) => {
    let key = kept.get(formFieldKey(field.target)) ?? slugifyFieldKey(field.label);
    const base = key;
    for (let n = 2; used.has(key); n++) key = `${base.slice(0, 36)}-${n}`;
    used.add(key);
    return { ...field, key };
  });
}

export const formAfterSubmitValidator = v.union(
  v.object({ kind: v.literal('message'), message: v.string() }),
  v.object({ kind: v.literal('redirect'), url: v.string() }),
);

export const formValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  fields: v.array(formFieldValidator),
  buttonText: v.string(),
  afterSubmit: formAfterSubmitValidator,
  // The GDPR sentence next to the mandatory consent checkbox.
  consentText: v.string(),
  active: v.boolean(),
});

/**
 * One public submission. `values` is keyed by the field key
 * ({@link formFieldKey}); `ipHash` is a salted SHA-256 of the client IP —
 * enough to correlate abuse, never the raw address (GDPR).
 */
export const formSubmissionValidator = v.object({
  formId: v.id('forms'),
  leadId: v.id('leads'),
  values: v.record(v.string(), propertyValueValidator),
  ipHash: v.string(),
  userAgent: v.optional(v.string()),
});

/**
 * The browser-side identity behind progressive profiling: the embed stores the
 * token (localStorage) after a submission; later renders send it back so the
 * form can skip the fields the lead already filled. Maps to the lead — never
 * exposes lead data itself.
 */
export const formVisitorTokenValidator = v.object({
  token: v.string(),
  leadId: v.id('leads'),
});

export type FormFieldTarget = Infer<typeof formFieldTargetValidator>;
export type FormField = Infer<typeof formFieldValidator>;
export type FormFieldInput = Infer<typeof formFieldInputValidator>;
export type FormAfterSubmit = Infer<typeof formAfterSubmitValidator>;
export type Form = Infer<typeof formValidator>;
export type FormSubmission = Infer<typeof formSubmissionValidator>;

/** The identity of a field's target inside a form (one field per target); the public key is `field.key`. */
export function formFieldKey(target: FormFieldTarget): string {
  return target.kind === 'standard' ? `std:${target.field}` : `cp:${target.propertyDefId}`;
}

/**
 * Structural validation of a form's editable shape. Returns an error code, or
 * null. Custom-property existence is checked by the mutations (needs the db).
 */
export function validateFormShape(form: {
  name: string;
  fields: FormFieldInput[];
  buttonText: string;
  afterSubmit: FormAfterSubmit;
  consentText: string;
}): string | null {
  if (!form.name.trim()) return 'form_name_required';
  if (form.fields.length === 0) return 'form_fields_required';
  if (form.fields.length > MAX_FORM_FIELDS) return 'form_too_many_fields';
  const targets = new Set<string>();
  for (const field of form.fields) {
    if (!field.label.trim()) return 'form_field_label_required';
    const target = formFieldKey(field.target);
    if (targets.has(target)) return 'form_duplicate_field';
    targets.add(target);
    if (field.key !== undefined && !FIELD_KEY_RE.test(field.key)) return 'form_invalid_field_key';
  }
  if (!form.buttonText.trim()) return 'form_button_text_required';
  // The GDPR checkbox is mandatory, so its sentence is too.
  if (!form.consentText.trim()) return 'form_consent_text_required';
  if (form.afterSubmit.kind === 'redirect' && !/^https?:\/\//.test(form.afterSubmit.url.trim())) {
    return 'form_invalid_redirect_url';
  }
  if (form.afterSubmit.kind === 'message' && !form.afterSubmit.message.trim()) {
    return 'form_message_required';
  }
  return null;
}
