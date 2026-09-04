import type { Doc, Id } from '../_generated/dataModel';
import type { PropertyValue } from '../_lib/validators/properties';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  defaultPipelineStage,
  isTransitionAllowed,
  pipelineStage,
  stageRequiresTag,
  validateStageTags,
  type PipelineStage,
} from '../_lib/validators/deals';
import { dispatchWorkflowTrigger } from '../features/workflows/triggerDispatch';
import { createAuditFields, logAudit } from './audit';
import { isNotDeleted } from './dbHelpers';
import { cleanOwnerIds } from './owners';
import {
  applyLifecycleTransition,
  loadLifecycleConfig,
  planLifecycleTransition,
} from './lifecycle';

/** A live pipeline, or throw. */
export async function loadPipeline(
  ctx: QueryCtx | MutationCtx,
  pipelineId: Id<'pipelines'>,
): Promise<Doc<'pipelines'>> {
  const pipeline = await ctx.db.get(pipelineId);
  if (!pipeline || !isNotDeleted(pipeline)) throw new Error('pipeline_not_found');
  return pipeline;
}

/** Live pipelines, default first then by name. */
export async function listLivePipelines(ctx: QueryCtx | MutationCtx): Promise<Doc<'pipelines'>[]> {
  const all = (await ctx.db.query('pipelines').collect()).filter(isNotDeleted);
  return all.sort((a, b) => {
    if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
}

/** The default pipeline (flagged, else the first), or null when none exists yet. */
export async function defaultPipeline(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<'pipelines'> | null> {
  const pipelines = await listLivePipelines(ctx);
  return pipelines[0] ?? null;
}

/** Create the stock pipeline when the instance has none. Returns its id. */
export async function ensureDefaultPipeline(
  ctx: MutationCtx,
  userId: Id<'users'>,
): Promise<Id<'pipelines'>> {
  const existing = await defaultPipeline(ctx);
  if (existing) return existing._id;
  const pipelineId = await ctx.db.insert('pipelines', {
    name: DEFAULT_PIPELINE_NAME,
    stages: [...DEFAULT_PIPELINE_STAGES],
    isDefault: true,
    ...createAuditFields(userId),
  });
  await logAudit({ ctx, userId, entityType: 'pipeline', entityId: pipelineId, action: 'create' });
  return pipelineId;
}

export type DealChangeMeta = {
  source: 'create' | 'manual' | 'workflow' | 'api';
  changedBy?: Id<'users'>;
  apiKeyId?: Id<'apiKeys'>;
  workflowId?: Id<'workflows'>;
  /** The run whose step caused the change (self-enrollment guard). */
  runSource?: { runId: Id<'workflowRuns'>; workflowId: Id<'workflows'> };
};

/** Tags and comment given when entering a stage. */
export type StageEntry = { tags?: string[]; comment?: string };

async function insertHistory(
  ctx: MutationCtx,
  deal: Pick<Doc<'deals'>, '_id' | 'pipelineId'>,
  from: string | undefined,
  to: string,
  meta: DealChangeMeta,
  entry: StageEntry,
): Promise<void> {
  await ctx.db.insert('dealStageHistory', {
    dealId: deal._id,
    pipelineId: deal.pipelineId,
    from,
    to,
    source: meta.source,
    changedBy: meta.changedBy,
    workflowId: meta.workflowId,
    tags: entry.tags?.length ? entry.tags : undefined,
    comment: entry.comment,
  });
}

/** The stage entry to store, or the reason it can't be (unknown tag, or a required tag missing). */
function stageEntryFor(
  stage: PipelineStage,
  opts: StageEntry,
): { entry: StageEntry } | { error: 'unknown_tag' | 'tag_required' } {
  const tags = validateStageTags(stage, opts.tags);
  if (!tags) return { error: 'unknown_tag' };
  if (stageRequiresTag(stage) && tags.length === 0) return { error: 'tag_required' };
  return { entry: { tags, comment: opts.comment?.trim() || undefined } };
}

/** Fire a deal event for the deal's lead (deals without a lead enroll nobody). */
async function dispatchDealEvents(
  ctx: MutationCtx,
  deal: Doc<'deals'>,
  stage: PipelineStage,
  meta: DealChangeMeta,
  opts: { created: boolean },
): Promise<void> {
  if (!deal.leadId) return;
  const base = { pipelineId: deal.pipelineId, dealId: deal._id };
  const dispatch = (event: Parameters<typeof dispatchWorkflowTrigger>[2]) =>
    dispatchWorkflowTrigger(ctx, deal.leadId!, event, { source: meta.runSource });
  if (opts.created) await dispatch({ type: 'deal_created', ...base });
  else await dispatch({ type: 'deal_stage_changed', stageKey: stage.key, ...base });
  if (stage.kind === 'won') await dispatch({ type: 'deal_won', ...base });
  if (stage.kind === 'lost') await dispatch({ type: 'deal_lost', ...base });
}

async function promoteLeadOnWin(ctx: MutationCtx, deal: Doc<'deals'>): Promise<void> {
  if (!deal.leadId) return;
  const lead = await ctx.db.get(deal.leadId);
  if (!lead || lead.deletedAt != null) return;
  const config = await loadLifecycleConfig(ctx);
  if (!config.stages.some((s) => s.key === 'customer')) return;
  const plan = planLifecycleTransition(config, lead, 'customer');
  if (plan.kind === 'change') {
    await applyLifecycleTransition(ctx, lead._id, plan, { source: 'deal' });
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** Field-level checks shared by create and update; throws `invalid_deal: <field>`. */
export async function validateDealFields(
  ctx: MutationCtx,
  fields: {
    title?: string;
    amount?: number;
    currency?: string;
    expectedCloseDate?: string;
    ownerIds?: Id<'users'>[];
    leadId?: Id<'leads'>;
    sourceCampaignId?: Id<'campaigns'>;
  },
): Promise<void> {
  if (fields.title !== undefined && !fields.title.trim()) throw new Error('deal_title_required');
  if (fields.amount !== undefined && (!Number.isFinite(fields.amount) || fields.amount < 0)) {
    throw new Error('invalid_deal: amount');
  }
  if (fields.currency !== undefined && !CURRENCY_RE.test(fields.currency.toUpperCase())) {
    throw new Error('invalid_deal: currency');
  }
  if (fields.expectedCloseDate !== undefined && !DATE_RE.test(fields.expectedCloseDate)) {
    throw new Error('invalid_deal: expectedCloseDate');
  }
  if (fields.ownerIds) await cleanOwnerIds(ctx, fields.ownerIds);
  if (fields.leadId) {
    const lead = await ctx.db.get(fields.leadId);
    if (!lead || !isNotDeleted(lead)) throw new Error('lead_not_found');
  }
  if (fields.sourceCampaignId && !(await ctx.db.get(fields.sourceCampaignId))) {
    throw new Error('invalid_deal: sourceCampaignId');
  }
}

export type NewDeal = {
  title: string;
  amount?: number;
  currency?: string;
  pipelineId?: Id<'pipelines'>;
  stageKey?: string;
  expectedCloseDate?: string;
  ownerIds?: Id<'users'>[];
  leadId?: Id<'leads'>;
  sourceCampaignId?: Id<'campaigns'>;
  customProperties?: Record<string, PropertyValue>;
  stageTags?: string[];
  stageComment?: string;
};

/**
 * Insert a deal in its pipeline stage (default pipeline / first open stage
 * when unset), log the initial history row, audit it when a user is behind
 * it, and fire `deal_created` (+ won/lost when created directly closed).
 */
export async function createDealRecord(
  ctx: MutationCtx,
  data: NewDeal,
  meta: DealChangeMeta,
): Promise<Id<'deals'>> {
  const pipeline = data.pipelineId
    ? await loadPipeline(ctx, data.pipelineId)
    : await defaultPipeline(ctx);
  if (!pipeline) throw new Error('pipeline_not_found');
  const stage = data.stageKey
    ? pipelineStage(pipeline, data.stageKey)
    : defaultPipelineStage(pipeline);
  if (!stage) throw new Error('unknown_stage');
  const checked = stageEntryFor(stage, { tags: data.stageTags, comment: data.stageComment });
  if ('error' in checked) {
    throw new Error(checked.error === 'tag_required' ? 'stage_tag_required' : 'unknown_stage_tag');
  }
  const entry = checked.entry;
  const now = Date.now();
  const dealId = await ctx.db.insert('deals', {
    title: data.title.trim(),
    amount: data.amount,
    currency: (data.currency ?? DEFAULT_CURRENCY).toUpperCase(),
    pipelineId: pipeline._id,
    stageKey: stage.key,
    status: stage.kind,
    expectedCloseDate: data.expectedCloseDate,
    closedAt: stage.kind === 'open' ? undefined : now,
    ownerIds: data.ownerIds ?? [],
    leadId: data.leadId,
    sourceCampaignId: data.sourceCampaignId,
    customProperties: data.customProperties,
    stageTags: entry.tags?.length ? entry.tags : undefined,
    stageComment: entry.comment,
    updatedAt: now,
    createdBy: meta.changedBy,
    updatedBy: meta.changedBy,
  });
  const deal = (await ctx.db.get(dealId))!;
  await insertHistory(ctx, deal, undefined, stage.key, meta, entry);
  if (meta.changedBy || meta.apiKeyId) {
    await logAudit({
      ctx,
      userId: meta.changedBy,
      apiKeyId: meta.apiKeyId,
      entityType: 'deal',
      entityId: dealId,
      action: 'create',
      metadata: { source: meta.source, pipelineId: pipeline._id, stageKey: stage.key },
    });
  }
  await dispatchDealEvents(ctx, deal, stage, meta, { created: true });
  if (stage.kind === 'won') await promoteLeadOnWin(ctx, deal);
  return dealId;
}

export type StageMove =
  | { kind: 'unchanged' }
  | { kind: 'unknown_stage' }
  /** A given tag is not one of the target stage's. */
  | { kind: 'unknown_tag'; stage: PipelineStage }
  /** The target stage has tags and none was given. */
  | { kind: 'tag_required'; stage: PipelineStage }
  /** The pipeline's transition graph has no arrow for this move. */
  | { kind: 'forbidden'; stage: PipelineStage }
  | { kind: 'moved'; stage: PipelineStage };

/** The single path every stage move goes through; the transition graph is enforced here. */
export async function moveDealToStage(
  ctx: MutationCtx,
  deal: Doc<'deals'>,
  stageKey: string,
  meta: DealChangeMeta,
  opts: StageEntry = {},
): Promise<StageMove> {
  const pipeline = await loadPipeline(ctx, deal.pipelineId);
  const stage = pipelineStage(pipeline, stageKey);
  if (!stage) return { kind: 'unknown_stage' };
  if (deal.stageKey === stage.key) return { kind: 'unchanged' };
  if (!isTransitionAllowed(pipeline, deal.stageKey, stage.key)) return { kind: 'forbidden', stage };
  const checked = stageEntryFor(stage, opts);
  if ('error' in checked) return { kind: checked.error, stage };
  const entry = checked.entry;
  const now = Date.now();
  const closed = stage.kind !== 'open';
  await ctx.db.patch(deal._id, {
    stageKey: stage.key,
    status: stage.kind,
    closedAt: closed ? now : undefined,
    stageTags: entry.tags?.length ? entry.tags : undefined,
    stageComment: entry.comment,
    updatedAt: now,
    updatedBy: meta.changedBy ?? deal.updatedBy,
  });
  await insertHistory(ctx, deal, deal.stageKey, stage.key, meta, entry);
  if (meta.changedBy || meta.apiKeyId) {
    await logAudit({
      ctx,
      userId: meta.changedBy,
      apiKeyId: meta.apiKeyId,
      entityType: 'deal',
      entityId: deal._id,
      action: 'update',
      metadata: {
        changes: { stageKey: { old: deal.stageKey, new: stage.key } },
        source: meta.source,
      },
    });
  }
  const fresh = (await ctx.db.get(deal._id))!;
  await dispatchDealEvents(ctx, fresh, stage, meta, { created: false });
  if (stage.kind === 'won') await promoteLeadOnWin(ctx, fresh);
  return { kind: 'moved', stage };
}

/** The lead's most recently created open deal, optionally within one pipeline. */
export async function latestOpenDealOfLead(
  ctx: QueryCtx | MutationCtx,
  leadId: Id<'leads'>,
  pipelineId?: Id<'pipelines'>,
): Promise<Doc<'deals'> | null> {
  const deals = await ctx.db
    .query('deals')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .order('desc')
    .collect();
  return (
    deals.find(
      (d) =>
        isNotDeleted(d) &&
        d.status === 'open' &&
        (pipelineId === undefined || d.pipelineId === pipelineId),
    ) ?? null
  );
}
