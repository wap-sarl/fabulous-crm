import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { type AuditActor, createAuditFields, logAudit } from '../audit/log';
import { generateHexToken } from '../security/crypto';
import { dispatchWorkflowTrigger } from '../workflows/dispatch';
import { dedupeKeys } from '../duplicates/detection';
import { insertLifecycleHistory } from './lifecycle';
import { leadSearchText } from './search';
import { type LeadSignalKind, stampLeadSignal } from './signals';

const CONSENT_TOKEN_BYTES = 24;

/** Who creates the contact: the actor of the journal and the source of the lifecycle history. */
export type LeadOrigin =
  | { source: 'manual' | 'import'; userId: Id<'users'> }
  | { source: 'api'; apiKeyId: Id<'apiKeys'> }
  | { source: 'form'; formId: Id<'forms'> };

/** What the caller decides of a new contact; it has checked each value and passed the creation gate. */
export type NewLead = Pick<Doc<'leads'>, 'firstName' | 'lastName' | 'ownerIds'> & {
  lifecycleStage: string;
} & Partial<
    Pick<
      Doc<'leads'>,
      | 'email'
      | 'phone'
      | 'address'
      | 'comment'
      | 'companyId'
      | 'isRedFlagged'
      | 'customProperties'
      | 'marketingConsent'
      | 'consentUpdatedAt'
      | 'consentSource'
    >
  >;

/** How each origin signs the journal. */
function signatureOf(by: LeadOrigin): { actor: AuditActor; metadata?: Record<string, unknown> } {
  switch (by.source) {
    case 'manual':
      return { actor: { userId: by.userId } };
    case 'import':
      return { actor: { userId: by.userId }, metadata: { source: 'import' } };
    case 'api':
      return { actor: { apiKeyId: by.apiKeyId } };
    case 'form':
      return { actor: {}, metadata: { source: 'form', formId: by.formId } };
  }
}

/** The one place a contact is created: the row, its journal entry, the first line of its lifecycle history, then the workflows; `signal` is what the creation itself counts as, stamped before the workflows look. */
export async function createLeadRecord(
  ctx: MutationCtx,
  by: LeadOrigin,
  fields: NewLead,
  opts: { workflows?: Doc<'workflows'>[]; signal?: { kind: LeadSignalKind; at: number } } = {},
): Promise<Id<'leads'>> {
  const { actor, metadata } = signatureOf(by);
  const company = fields.companyId ? await ctx.db.get(fields.companyId) : null;
  const leadId = await ctx.db.insert('leads', {
    ...fields,
    // What the trigger would add in a second write: with it here, the contact is written once.
    searchText: leadSearchText(fields, company?.name),
    dedupe: dedupeKeys(fields),
    // Consent starts empty unless the person gave it on the form that creates them; after that only they change it, through the public link.
    marketingConsent: fields.marketingConsent ?? [],
    consentToken: generateHexToken(CONSENT_TOKEN_BYTES),
    isRedFlagged: fields.isRedFlagged ?? false,
    ...createAuditFields(actor.userId),
  });
  // The audit entry first, whatever else the write records: afterChange consumers see `create` before the rest.
  await logAudit({
    ctx,
    ...actor,
    entityType: 'lead',
    entityId: leadId,
    action: 'create',
    metadata,
  });
  await insertLifecycleHistory(
    ctx,
    leadId,
    { from: undefined, to: fields.lifecycleStage },
    { source: by.source, changedBy: actor.userId },
  );
  if (opts.signal) await stampLeadSignal(ctx, leadId, opts.signal.kind, opts.signal.at);
  await dispatchWorkflowTrigger(
    ctx,
    leadId,
    { type: 'lead_created' },
    { workflows: opts.workflows },
  );
  return leadId;
}
