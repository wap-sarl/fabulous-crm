import { ValidationError, nullable, validate } from 'convex-helpers/validators';
import { type Infer, v, type Validator } from 'convex/values';
import { activityTypeValidator } from '../_lib/validators/activities';
import { propertyValueValidator } from '../_lib/validators/properties';
import { addressValidator } from '../_lib/validators/shared';
import { apiError } from './apiErrors';


const idString = v.string();
const idList = v.array(v.string());
const customPropertiesPatch = v.record(v.string(), nullable(propertyValueValidator));

const companyHint = v.object({
  name: v.optional(v.string()),
  country: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  domain: v.optional(v.string()),
});

export const contactCreateBody = v.object({
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(addressValidator),
  comment: v.optional(v.string()),
  ownerIds: v.optional(idList),
  isRedFlagged: v.optional(v.boolean()),
  lifecycleStage: v.optional(v.string()),
  companyId: v.optional(idString),
  // Match (domain, registration, VAT) or create the company by name.
  company: v.optional(companyHint),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type ContactCreateBody = Infer<typeof contactCreateBody>;

export const contactPatchBody = v.object({
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  email: v.optional(nullable(v.string())),
  phone: v.optional(nullable(v.string())),
  address: v.optional(nullable(addressValidator)),
  comment: v.optional(nullable(v.string())),
  ownerIds: v.optional(idList),
  isRedFlagged: v.optional(v.boolean()),
  lifecycleStage: v.optional(v.string()),
  companyId: v.optional(nullable(idString)),
  customProperties: v.optional(customPropertiesPatch),
});
export type ContactPatchBody = Infer<typeof contactPatchBody>;

/** Consent is the lead's own (GDPR trail on the consent page); the rest is computed. */
const CONTACT_READ_ONLY = [
  'marketingConsent',
  'consentSource',
  'consentUpdatedAt',
  'consentToken',
  'leadScore',
  'lastActivityAt',
  'emailOpenCount',
  'emailClickCount',
  'formSubmissionCount',
];

export const companyCreateBody = v.object({
  name: v.string(),
  country: v.optional(v.string()),
  registrationNumber: v.optional(v.string()),
  vatNumber: v.optional(v.string()),
  domain: v.optional(v.string()),
  website: v.optional(v.string()),
  sector: v.optional(v.string()),
  headcount: v.optional(v.number()),
  address: v.optional(addressValidator),
  ownerIds: v.optional(idList),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type CompanyCreateBody = Infer<typeof companyCreateBody>;

export const companyPatchBody = v.object({
  name: v.optional(v.string()),
  country: v.optional(v.string()),
  registrationNumber: v.optional(nullable(v.string())),
  vatNumber: v.optional(nullable(v.string())),
  domain: v.optional(nullable(v.string())),
  website: v.optional(nullable(v.string())),
  sector: v.optional(nullable(v.string())),
  headcount: v.optional(nullable(v.number())),
  address: v.optional(nullable(addressValidator)),
  ownerIds: v.optional(idList),
  customProperties: v.optional(customPropertiesPatch),
});
export type CompanyPatchBody = Infer<typeof companyPatchBody>;

export const dealCreateBody = v.object({
  title: v.string(),
  amount: v.optional(v.number()),
  currency: v.optional(v.string()),
  pipelineId: v.optional(idString),
  stageKey: v.optional(v.string()),
  stageTags: v.optional(v.array(v.string())),
  stageComment: v.optional(v.string()),
  expectedCloseDate: v.optional(v.string()),
  ownerIds: v.optional(idList),
  leadId: v.optional(idString),
  sourceCampaignId: v.optional(idString),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type DealCreateBody = Infer<typeof dealCreateBody>;

export const dealPatchBody = v.object({
  title: v.optional(v.string()),
  amount: v.optional(nullable(v.number())),
  currency: v.optional(v.string()),
  // A stage change goes through the transition graph like a Kanban drop.
  stageKey: v.optional(v.string()),
  stageTags: v.optional(v.array(v.string())),
  stageComment: v.optional(v.string()),
  expectedCloseDate: v.optional(nullable(v.string())),
  ownerIds: v.optional(idList),
  leadId: v.optional(nullable(idString)),
  sourceCampaignId: v.optional(nullable(idString)),
  customProperties: v.optional(customPropertiesPatch),
});
export type DealPatchBody = Infer<typeof dealPatchBody>;

const DEAL_READ_ONLY = ['status', 'closedAt', 'pipelineId'];

const activityOpenOrDone = v.union(v.literal('open'), v.literal('done'));
const activityStatus = v.union(v.literal('open'), v.literal('done'), v.literal('cancelled'));

export const activityCreateBody = v.object({
  type: activityTypeValidator,
  title: v.string(),
  description: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  status: v.optional(activityOpenOrDone),
  ownerId: v.optional(idString),
  teamId: v.optional(idString),
  leadId: v.optional(idString),
  companyId: v.optional(idString),
  dealId: v.optional(idString),
  outcome: v.optional(v.string()),
  customProperties: v.optional(v.record(v.string(), propertyValueValidator)),
});
export type ActivityCreateBody = Infer<typeof activityCreateBody>;

export const activityPatchBody = v.object({
  type: v.optional(activityTypeValidator),
  title: v.optional(v.string()),
  description: v.optional(nullable(v.string())),
  dueAt: v.optional(nullable(v.number())),
  status: v.optional(activityStatus),
  ownerId: v.optional(nullable(idString)),
  teamId: v.optional(nullable(idString)),
  leadId: v.optional(nullable(idString)),
  companyId: v.optional(nullable(idString)),
  dealId: v.optional(nullable(idString)),
  outcome: v.optional(nullable(v.string())),
  customProperties: v.optional(customPropertiesPatch),
});
export type ActivityPatchBody = Infer<typeof activityPatchBody>;

const ACTIVITY_READ_ONLY = ['completedAt'];

export const READ_ONLY_FIELDS: Record<'contacts' | 'companies' | 'deals' | 'activities', string[]> =
  {
    contacts: CONTACT_READ_ONLY,
    companies: [],
    deals: DEAL_READ_ONLY,
    activities: ACTIVITY_READ_ONLY,
  };

/** Fields every DTO carries that are never writable. */
const SYSTEM_FIELDS = ['id', 'createdAt', 'updatedAt'];

/** Validate a JSON body: read-only fields → `read_only_field`, unknown/mistyped → `invalid_fields`. */
export function parseBody<V extends Validator<unknown, 'required', string>>(
  validator: V,
  body: unknown,
  readOnly: string[] = [],
): Infer<V> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw apiError(400, 'invalid_body', 'The request body must be a JSON object.');
  }
  for (const field of Object.keys(body)) {
    if (readOnly.includes(field) || SYSTEM_FIELDS.includes(field)) {
      throw apiError(400, 'read_only_field', `${field} cannot be written through the API.`, {
        field,
      });
    }
  }
  try {
    validate(validator, body, { throw: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      throw apiError(400, 'invalid_fields', error.message, {
        path: error.path ?? null,
        expected: error.expected,
        got: error.got,
      });
    }
    throw error;
  }
  return body as Infer<V>;
}
