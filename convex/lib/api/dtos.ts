import { v } from 'convex/values';
import { addressValidator } from '../../_lib/validators/shared';
import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import { consentSourceValidator } from '../../_lib/validators/crm';
import { propertyValueValidator } from '../../_lib/validators/properties';
import { dealStatusValidator } from '../../_lib/validators/deals';
import { activityTypeValidator } from '../../_lib/validators/activities';
import { activityStatusValidator } from '../../_lib/validators/activities';
import { propertyTypeValidator } from '../../_lib/validators/properties';
import { propertyOptionValidator } from '../../_lib/validators/properties';
import { propertyValidationValidator } from '../../_lib/validators/properties';
import type { Doc } from '../../_generated/dataModel';

const base = (doc: { _id: string; _creationTime: number; updatedAt: number }) => ({
  id: doc._id,
  createdAt: doc._creationTime,
  updatedAt: doc.updatedAt,
});

export function toPublicContact(lead: Doc<'leads'>) {
  return {
    ...base(lead),
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email ?? null,
    phone: lead.phone ?? null,
    address: lead.address ?? null,
    comment: lead.comment ?? null,
    companyId: lead.companyId ?? null,
    ownerIds: lead.ownerIds,
    isRedFlagged: lead.isRedFlagged,
    lifecycleStage: lead.lifecycleStage ?? null,
    leadScore: lead.leadScore ?? null,
    marketingConsent: lead.marketingConsent,
    consentSource: lead.consentSource ?? null,
    consentUpdatedAt: lead.consentUpdatedAt ?? null,
    lastActivityAt: lead.lastActivityAt ?? null,
    emailOpenCount: lead.emailOpenCount ?? 0,
    emailClickCount: lead.emailClickCount ?? 0,
    formSubmissionCount: lead.formSubmissionCount ?? 0,
    customProperties: lead.customProperties ?? {},
  };
}

export function toPublicCompany(company: Doc<'companies'>) {
  return {
    ...base(company),
    name: company.name,
    country: company.country,
    registrationNumber: company.registrationNumber ?? null,
    vatNumber: company.vatNumber ?? null,
    domain: company.domain ?? null,
    website: company.website ?? null,
    sector: company.sector ?? null,
    headcount: company.headcount ?? null,
    address: company.address ?? null,
    ownerIds: company.ownerIds,
    customProperties: company.customProperties ?? {},
  };
}

export function toPublicDeal(deal: Doc<'deals'>) {
  return {
    ...base(deal),
    title: deal.title,
    amount: deal.amount ?? null,
    currency: deal.currency,
    pipelineId: deal.pipelineId,
    stageKey: deal.stageKey,
    status: deal.status,
    expectedCloseDate: deal.expectedCloseDate ?? null,
    closedAt: deal.closedAt ?? null,
    leadId: deal.leadId ?? null,
    ownerIds: deal.ownerIds,
    sourceCampaignId: deal.sourceCampaignId ?? null,
    customProperties: deal.customProperties ?? {},
  };
}

export function toPublicActivity(activity: Doc<'activities'>) {
  return {
    ...base(activity),
    type: activity.type,
    title: activity.title,
    description: activity.description ?? null,
    status: activity.status,
    dueAt: activity.dueAt ?? null,
    completedAt: activity.completedAt ?? null,
    outcome: activity.outcome ?? null,
    ownerId: activity.ownerId ?? null,
    teamId: activity.teamId ?? null,
    leadId: activity.leadId ?? null,
    companyId: activity.companyId ?? null,
    dealId: activity.dealId ?? null,
    customProperties: activity.customProperties ?? {},
  };
}

export function toPublicList(list: Doc<'leadLists'>) {
  return {
    ...base(list),
    name: list.name,
    kind: list.kind ?? 'static',
  };
}

export function toPublicPropertyDefinition(def: Doc<'propertyDefinitions'>) {
  return {
    id: def._id,
    entityType: def.entityType,
    label: def.label,
    type: def.type,
    options: def.options ?? null,
    validation: def.validation ?? null,
    computed: def.computed === true,
  };
}

/** What `toPublicContact` gives, as a validator. */
export const publicContactValidator = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.union(v.string(), v.null()),
  phone: v.union(v.string(), v.null()),
  address: v.union(addressValidator, v.null()),
  comment: v.union(v.string(), v.null()),
  companyId: v.union(v.id('companies'), v.null()),
  ownerIds: v.array(v.id('users')),
  isRedFlagged: v.boolean(),
  lifecycleStage: v.union(v.string(), v.null()),
  leadScore: v.union(v.number(), v.null()),
  marketingConsent: v.array(marketingConsentChannelValidator),
  consentSource: v.union(consentSourceValidator, v.null()),
  consentUpdatedAt: v.union(v.number(), v.null()),
  lastActivityAt: v.union(v.number(), v.null()),
  emailOpenCount: v.number(),
  emailClickCount: v.number(),
  formSubmissionCount: v.number(),
  customProperties: v.record(v.string(), propertyValueValidator),
  id: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** What `toPublicCompany` gives, as a validator. */
export const publicCompanyValidator = v.object({
  name: v.string(),
  country: v.string(),
  registrationNumber: v.union(v.string(), v.null()),
  vatNumber: v.union(v.string(), v.null()),
  domain: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  sector: v.union(v.string(), v.null()),
  headcount: v.union(v.number(), v.null()),
  address: v.union(addressValidator, v.null()),
  ownerIds: v.array(v.id('users')),
  customProperties: v.record(v.string(), propertyValueValidator),
  id: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** What `toPublicDeal` gives, as a validator. */
export const publicDealValidator = v.object({
  title: v.string(),
  amount: v.union(v.number(), v.null()),
  currency: v.string(),
  pipelineId: v.id('pipelines'),
  stageKey: v.string(),
  status: dealStatusValidator,
  expectedCloseDate: v.union(v.string(), v.null()),
  closedAt: v.union(v.number(), v.null()),
  leadId: v.union(v.id('leads'), v.null()),
  ownerIds: v.array(v.id('users')),
  sourceCampaignId: v.union(v.id('campaigns'), v.null()),
  customProperties: v.record(v.string(), propertyValueValidator),
  id: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** What `toPublicActivity` gives, as a validator. */
export const publicActivityValidator = v.object({
  type: activityTypeValidator,
  title: v.string(),
  description: v.union(v.string(), v.null()),
  status: activityStatusValidator,
  dueAt: v.union(v.number(), v.null()),
  completedAt: v.union(v.number(), v.null()),
  outcome: v.union(v.string(), v.null()),
  ownerId: v.union(v.id('users'), v.null()),
  teamId: v.union(v.id('teams'), v.null()),
  leadId: v.union(v.id('leads'), v.null()),
  companyId: v.union(v.id('companies'), v.null()),
  dealId: v.union(v.id('deals'), v.null()),
  customProperties: v.record(v.string(), propertyValueValidator),
  id: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** What `toPublicList` gives, as a validator. */
export const publicListValidator = v.object({
  name: v.string(),
  kind: v.union(v.literal('static'), v.literal('dynamic')),
  id: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/** What `toPublicPropertyDefinition` gives, as a validator. */
export const publicPropertyDefinitionValidator = v.object({
  id: v.id('propertyDefinitions'),
  entityType: v.union(
    v.literal('lead'),
    v.literal('company'),
    v.literal('deal'),
    v.literal('activity'),
  ),
  label: v.string(),
  type: propertyTypeValidator,
  options: v.union(v.array(propertyOptionValidator), v.null()),
  validation: v.union(propertyValidationValidator, v.null()),
  computed: v.boolean(),
});
