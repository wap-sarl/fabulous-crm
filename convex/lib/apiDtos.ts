import type { Doc } from '../_generated/dataModel';

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
