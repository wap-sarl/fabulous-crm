import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { FORM_VISITOR_TOKEN_BYTES, type FormStandardField } from '../_lib/validators/forms';
import { validatePropertyValue, type PropertyValue } from '../_lib/validators/properties';
import { PROPERTY_TYPES } from '../_lib/validators/propertyTypes';
import { findCompanyByDomain } from './companies';
import { companyDomainOfEmail } from './companyDomains';
import { generateHexToken } from './crypto';
import { isNotDeleted } from './dbHelpers';

/** Input widget of a public form field (embed + preview render on this). */
export type FormInputKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'number'
  | 'date'
  | 'boolean'
  | 'select'
  | 'radio'
  | 'checkbox';

const STANDARD_INPUT: Record<FormStandardField, FormInputKind> = {
  firstName: 'text',
  lastName: 'text',
  email: 'email',
  phone: 'tel',
  company: 'text',
  comment: 'textarea',
};

const CUSTOM_INPUT: Record<Doc<'propertyDefinitions'>['type'], FormInputKind> = {
  text: 'text',
  number: 'number',
  email: 'email',
  select: 'select',
  radio: 'radio',
  checkbox: 'checkbox',
  date: 'date',
  boolean: 'boolean',
  rpps: 'text',
};

export interface PublicFormField {
  key: string;
  label: string;
  required: boolean;
  input: FormInputKind;
  options?: { value: string; label: string }[];
}

/** Free-text inputs are capped server-side whatever the client sends. */
const MAX_LENGTH: Record<FormStandardField, number> = {
  firstName: 100,
  lastName: 100,
  email: 254,
  phone: 30,
  company: 120,
  comment: 2000,
};

export async function loadLiveForm(
  ctx: QueryCtx | MutationCtx,
  formId: Id<'forms'>,
): Promise<Doc<'forms'> | null> {
  const form = await ctx.db.get(formId);
  return form && isNotDeleted(form) && form.active ? form : null;
}

export async function leadOfVisitorToken(
  ctx: QueryCtx | MutationCtx,
  token: string | undefined,
): Promise<Doc<'leads'> | null> {
  if (!token) return null;
  const row = await ctx.db
    .query('formVisitorTokens')
    .withIndex('by_token', (q) => q.eq('token', token))
    .first();
  const lead = row ? await ctx.db.get(row.leadId) : null;
  return lead && isNotDeleted(lead) ? lead : null;
}

/** The visitor token identifying `leadId`, created on first use. */
export async function ensureVisitorToken(ctx: MutationCtx, leadId: Id<'leads'>): Promise<string> {
  const existing = await ctx.db
    .query('formVisitorTokens')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .first();
  if (existing) return existing.token;
  const token = generateHexToken(FORM_VISITOR_TOKEN_BYTES);
  await ctx.db.insert('formVisitorTokens', { token, leadId });
  return token;
}

/** A token that identifies nobody, for the answers a bot gets: shaped like a real one, stored nowhere. */
export const decoyVisitorToken = (): string => generateHexToken(FORM_VISITOR_TOKEN_BYTES);

/** The live contact on that e-mail, the most recent when the address is doubled; a deleted one is a stranger to a public form. */
export async function findLiveLeadByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<'leads'> | null> {
  const rows = await ctx.db
    .query('leads')
    .withIndex('by_email', (q) => q.eq('email', email))
    .collect();
  return rows.filter(isNotDeleted).sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
}

/** Whether the lead already carries a value for this form field. */
export function leadHasFieldValue(
  lead: Doc<'leads'>,
  target: Doc<'forms'>['fields'][number]['target'],
): boolean {
  if (target.kind === 'custom') {
    const value = lead.customProperties?.[target.propertyDefId];
    return value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
  }
  if (target.field === 'company') return lead.companyId !== undefined;
  const value = lead[target.field];
  return typeof value === 'string' && value.trim() !== '';
}

/** Whether the form asks for an e-mail: without one, a browser token proves nothing about who is typing. */
export const hasEmailField = (form: Doc<'forms'>): boolean =>
  form.fields.some((f) => f.target.kind === 'standard' && f.target.field === 'email');

/**
 * The JSON the public embed renders from: resolved fields (dead custom properties dropped) and, when the visitor
 * is a known lead, the keys to skip — key names only, never the lead's values (progressive profiling must not
 * leak data to whoever holds a token). A form without an e-mail field skips nothing: on a shared browser the
 * token proves nothing about who is typing.
 */
export function buildPublicForm(
  form: Doc<'forms'>,
  defsById: Map<string, Doc<'propertyDefinitions'>>,
  visitorLead: Doc<'leads'> | null,
): {
  fields: PublicFormField[];
  knownFields: string[];
  buttonText: string;
  consentText: string;
  afterSubmit: Doc<'forms'>['afterSubmit'];
} {
  const fields: PublicFormField[] = [];
  const knownFields: string[] = [];
  const known = visitorLead && hasEmailField(form) ? visitorLead : null;
  for (const field of form.fields) {
    if (field.target.kind === 'custom') {
      const def = defsById.get(field.target.propertyDefId);
      if (!def || def.deletedAt !== undefined || def.computed) continue;
      fields.push({
        key: field.key,
        label: field.label,
        required: field.required,
        input: CUSTOM_INPUT[def.type],
        options: def.options?.map((o) => ({ value: o.value, label: o.label })),
      });
    } else {
      fields.push({
        key: field.key,
        label: field.label,
        required: field.required,
        input: STANDARD_INPUT[field.target.field],
      });
    }
    if (known && leadHasFieldValue(known, field.target)) knownFields.push(field.key);
  }
  return {
    fields,
    knownFields,
    buttonText: form.buttonText,
    consentText: form.consentText,
    afterSubmit: form.afterSubmit,
  };
}

export interface CleanSubmission {
  standard: Partial<Record<FormStandardField, string>>;
  custom: Record<string, PropertyValue>;
  /** Per-field French error messages, keyed like `values`. */
  errors: Record<string, string>;
}

/**
 * Server-side validation of submitted values against the form's fields (shared property validators). A required
 * field may be absent only when the visitor's lead already holds a value for it (progressive profiling skipped it).
 */
export function cleanSubmissionValues(
  form: Doc<'forms'>,
  defsById: Map<string, Doc<'propertyDefinitions'>>,
  values: Record<string, PropertyValue>,
  visitorLead: Doc<'leads'> | null,
): CleanSubmission {
  const standard: Partial<Record<FormStandardField, string>> = {};
  const custom: Record<string, PropertyValue> = {};
  const errors: Record<string, string> = {};
  const skippable = visitorLead && hasEmailField(form) ? visitorLead : null;

  for (const field of form.fields) {
    const key = field.key;
    const raw = values[key];
    const known = skippable !== null && leadHasFieldValue(skippable, field.target);

    if (field.target.kind === 'custom') {
      const def = defsById.get(field.target.propertyDefId);
      if (!def || def.deletedAt !== undefined || def.computed) continue;
      const cleaned = PROPERTY_TYPES[def.type].sanitize(raw, def);
      if (cleaned === undefined) {
        if (field.required && !known) errors[key] = 'Ce champ est requis.';
        continue;
      }
      const error = validatePropertyValue(def, cleaned);
      if (error) errors[key] = error;
      else custom[def._id] = cleaned;
      continue;
    }

    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) {
      if (field.required && !known) errors[key] = 'Ce champ est requis.';
      continue;
    }
    const max = MAX_LENGTH[field.target.field];
    if (text.length > max) {
      errors[key] = `Au plus ${max} caractères.`;
      continue;
    }
    if (field.target.field === 'email' && PROPERTY_TYPES.email.validate(text, {}) !== null) {
      errors[key] = 'Adresse e-mail invalide.';
      continue;
    }
    if (field.target.field === 'phone' && !parsePhoneNumberFromString(text, 'FR')?.isValid()) {
      errors[key] = 'Numéro de téléphone invalide.';
      continue;
    }
    standard[field.target.field] = text;
  }

  return { standard, custom, errors };
}

/**
 * The company a submission may attach a contact to: the live one on the e-mail's domain, and nothing else. A name
 * typed by an unknown visitor creates nothing and matches nothing (« Acme » must not walk into Acme); it stays in
 * the submission for an employee to qualify.
 */
export async function companyOfSubmission(
  ctx: QueryCtx | MutationCtx,
  email: string | undefined,
): Promise<Id<'companies'> | undefined> {
  const domain = companyDomainOfEmail(email);
  if (!domain) return undefined;
  return (await findCompanyByDomain(ctx, domain))?._id;
}

/** What a submission may write on a contact that already exists: the fields still empty, and nothing else. */
export function fillableUpdates(
  lead: Doc<'leads'>,
  standard: CleanSubmission['standard'],
  custom: CleanSubmission['custom'],
  companyId: Id<'companies'> | undefined,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of ['firstName', 'lastName', 'phone', 'comment'] as const) {
    const value = standard[field];
    if (value !== undefined && !(lead[field] ?? '').trim()) updates[field] = value;
  }
  const missing = Object.fromEntries(
    Object.entries(custom).filter(
      ([id]) =>
        !leadHasFieldValue(lead, {
          kind: 'custom',
          propertyDefId: id as Id<'propertyDefinitions'>,
        }),
    ),
  );
  if (Object.keys(missing).length > 0) {
    updates.customProperties = { ...lead.customProperties, ...missing };
  }
  if (companyId && lead.companyId === undefined) updates.companyId = companyId;
  return updates;
}

/** The comment a new contact starts with: what they typed, and the company they named, which no company row backs. */
export function initialComment(
  standard: CleanSubmission['standard'],
  attached: boolean,
): string | undefined {
  const parts: string[] = [];
  if (standard.company && !attached) parts.push(`Entreprise indiquée : ${standard.company}`);
  if (standard.comment) parts.push(standard.comment);
  return parts.length ? parts.join('\n') : undefined;
}

// Keys derived from the deployment's auth secret, one per purpose, as the OAuth state does without a shared key.
async function hmacKey(purpose: string): Promise<CryptoKey> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('form_secret_missing');
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${purpose}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Pseudonymised client IP: HMAC-SHA256 under a secret key, `FORM_IP_HASH_SALT` when set, else one derived from the
 * auth secret. A known salt would let anyone hash the four billion IPv4 addresses and read the table back.
 */
export async function hashClientIp(ip: string): Promise<string> {
  const salt = process.env.FORM_IP_HASH_SALT;
  const key = salt
    ? await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(salt),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
    : await hmacKey('form-ip');
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
}

/** The render stamp a definition carries: the time, signed with the form's id so a bot cannot make one up. */
export async function signRender(formId: string, ts: number): Promise<string> {
  const key = await hmacKey('form-render');
  return hex(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${formId}.${ts}`)),
  ).slice(0, 32);
}

export async function verifyRender(formId: string, ts: number, sig: string): Promise<boolean> {
  if (!Number.isFinite(ts) || typeof sig !== 'string' || sig.length !== 32) return false;
  const expected = await signRender(formId, ts);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
