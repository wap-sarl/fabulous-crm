import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  defaultPipelineStage,
  pipelineStage,
  type PipelineStage,
} from '../_lib/validators/deals';
import { dispatchWorkflowTrigger } from '../features/workflows/triggerDispatch';
import { createAuditFields, logAudit } from './audit';
import { isNotDeleted } from './dbHelpers';
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
  source: 'create' | 'manual' | 'workflow';
  changedBy?: Id<'users'>;
  workflowId?: Id<'workflows'>;
  /** The run whose step caused the change (self-enrollment guard). */
  runSource?: { runId: Id<'workflowRuns'>; workflowId: Id<'workflows'> };
};

async function insertHistory(
  ctx: MutationCtx,
  deal: Pick<Doc<'deals'>, '_id' | 'pipelineId'>,
  from: string | undefined,
  to: string,
  meta: DealChangeMeta,
): Promise<void> {
  await ctx.db.insert('dealStageHistory', {
    dealId: deal._id,
    pipelineId: deal.pipelineId,
    from,
    to,
    source: meta.source,
    changedBy: meta.changedBy,
    workflowId: meta.workflowId,
  });
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

export type NewDeal = {
  title: string;
  amount?: number;
  currency?: string;
  pipelineId?: Id<'pipelines'>;
  stageKey?: string;
  expectedCloseDate?: string;
  ownerId?: Id<'users'>;
  leadId?: Id<'leads'>;
  companyId?: Id<'companies'>;
  sourceCampaignId?: Id<'campaigns'>;
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
    ownerId: data.ownerId,
    leadId: data.leadId,
    companyId: data.companyId,
    sourceCampaignId: data.sourceCampaignId,
    updatedAt: now,
    createdBy: meta.changedBy,
    updatedBy: meta.changedBy,
  });
  const deal = (await ctx.db.get(dealId))!;
  await insertHistory(ctx, deal, undefined, stage.key, meta);
  if (meta.changedBy) {
    await logAudit({
      ctx,
      userId: meta.changedBy,
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
  | { kind: 'moved'; stage: PipelineStage };

/**
 * Move a deal to another stage of its pipeline. Entering a closed stage
 * stamps `closedAt` (and the loss reason for lost stages); reopening clears
 * them. Records the history row and fires the stage/won/lost triggers.
 */
export async function moveDealToStage(
  ctx: MutationCtx,
  deal: Doc<'deals'>,
  stageKey: string,
  meta: DealChangeMeta,
  opts: { lossReason?: string } = {},
): Promise<StageMove> {
  const pipeline = await loadPipeline(ctx, deal.pipelineId);
  const stage = pipelineStage(pipeline, stageKey);
  if (!stage) return { kind: 'unknown_stage' };
  if (deal.stageKey === stage.key) return { kind: 'unchanged' };
  const now = Date.now();
  const closed = stage.kind !== 'open';
  await ctx.db.patch(deal._id, {
    stageKey: stage.key,
    status: stage.kind,
    closedAt: closed ? now : undefined,
    lossReason: stage.kind === 'lost' ? opts.lossReason?.trim() || deal.lossReason : undefined,
    updatedAt: now,
    updatedBy: meta.changedBy ?? deal.updatedBy,
  });
  await insertHistory(ctx, deal, deal.stageKey, stage.key, meta);
  if (meta.changedBy) {
    await logAudit({
      ctx,
      userId: meta.changedBy,
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
