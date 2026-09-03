import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  FORM_VISITOR_TOKEN_BYTES,
  formFieldKey,
  type FormStandardField,
} from '../_lib/validators/forms';
import { validatePropertyValue, type PropertyValue } from '../_lib/validators/properties';
import { PROPERTY_TYPES } from '../_lib/validators/propertyTypes';
import { normalizeCountryCode } from '../_lib/validators/companyRegistry';
import { findCompanyByDomain } from './companies';
import { companyDomainOfEmail, websiteOfDomain } from './companyDomains';
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
const MAX_TEXT_LENGTH = 500;
const MAX_COMMENT_LENGTH = 2000;

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

/** Whether the lead already carries a value for this form field. */
function leadHasFieldValue(
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

/**
 * The JSON the public embed renders from: resolved fields (dead custom
 * properties dropped) and, when the visitor is a known lead, the keys to skip
 * — key names only, never the lead's values (progressive profiling must not
 * leak data to whoever holds a token).
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
  for (const field of form.fields) {
    const key = formFieldKey(field.target);
    if (field.target.kind === 'custom') {
      const def = defsById.get(field.target.propertyDefId);
      if (!def || def.deletedAt !== undefined || def.computed) continue;
      fields.push({
        key,
        label: field.label,
        required: field.required,
        input: CUSTOM_INPUT[def.type],
        options: def.options?.map((o) => ({ value: o.value, label: o.label })),
      });
    } else {
      fields.push({
        key,
        label: field.label,
        required: field.required,
        input: STANDARD_INPUT[field.target.field],
      });
    }
    if (visitorLead && leadHasFieldValue(visitorLead, field.target)) knownFields.push(key);
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
 * Server-side validation of submitted values against the form's fields (shared
 * property validators). A required field may be absent only when the visitor's
 * lead already holds a value for it (progressive profiling skipped it).
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

  for (const field of form.fields) {
    const key = formFieldKey(field.target);
    const raw = values[key];
    const known = visitorLead !== null && leadHasFieldValue(visitorLead, field.target);

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
    const max = field.target.field === 'comment' ? MAX_COMMENT_LENGTH : MAX_TEXT_LENGTH;
    if (text.length > max) {
      errors[key] = `Au plus ${max} caractères.`;
      continue;
    }
    if (field.target.field === 'email' && PROPERTY_TYPES.email.validate(text, {}) !== null) {
      errors[key] = 'Adresse e-mail invalide.';
      continue;
    }
    standard[field.target.field] = text;
  }

  return { standard, custom, errors };
}

/**
 * Company for a form submission: match by the lead email's company domain,
 * then by exact name; otherwise create it. System write — no user to blame,
 * unlike {@link import('./companies').resolveCompanyForLead}.
 */
export async function resolveFormCompany(
  ctx: MutationCtx,
  name: string,
  email: string | undefined,
): Promise<Id<'companies'>> {
  const domain = companyDomainOfEmail(email);
  if (domain) {
    const byDomain = await findCompanyByDomain(ctx, domain);
    if (byDomain) return byDomain._id;
  }
  const sameName = await ctx.db
    .query('companies')
    .withIndex('by_name', (q) => q.eq('name', name))
    .take(5);
  const byName = sameName.find(isNotDeleted);
  if (byName) return byName._id;
  return await ctx.db.insert('companies', {
    name,
    country: normalizeCountryCode(undefined),
    domain,
    website: domain ? websiteOfDomain(domain) : undefined,
    ownerIds: [],
    updatedAt: Date.now(),
  });
}

/** Salted SHA-256 of a client IP — correlate abuse without storing the address. */
export async function hashClientIp(ip: string): Promise<string> {
  const salt = process.env.FORM_IP_HASH_SALT ?? 'wap-crm-forms';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
