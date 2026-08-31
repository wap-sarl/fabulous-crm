import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import { dealStatusValidator, pipelineStage, stageTagLabels } from '../../_lib/validators/deals';
import {
  type DealAdvancedFilter,
  type DealStandardField,
  type FilterField,
  dealAdvancedFilterValidator,
} from '../../_lib/validators/filters';
import type { PropertyValue } from '../../_lib/validators/properties';
import { evalFilter } from '../../lib/filterMatching';
import { isNotDeleted } from '../../lib';
import {
  scopedStageTotals,
  scopedStatusTotals,
  stageTotals,
  statusTotals,
} from '../../lib/dealAggregates';
import { ownerNamespaces } from '../../lib/visibility';
import { listLivePipelines } from '../../lib/deals';
import { normalizeSearchText } from '../../lib/leadSearch';

/** Pipelines in display order (default first). */
export const listPipelines = employeeQuery({
  args: {},
  handler: async (ctx) => await listLivePipelines(ctx),
});

export const getPipelineStats = employeeQuery({
  args: { pipelineId: v.id('pipelines') },
  handler: async (ctx, args) => {
    const pipeline = await ctx.db.get(args.pipelineId);
    if (!pipeline || !isNotDeleted(pipeline)) return null;
    // Global aggregates for a full scope; per-primary-owner sums otherwise.
    const owners = ownerNamespaces(ctx.visibility, 'deals');
    if (owners === 'none') return null;
    const byStage = (stageKey: string) =>
      owners === 'all'
        ? stageTotals(ctx, pipeline._id, stageKey)
        : scopedStageTotals(ctx, owners, pipeline._id, stageKey);
    const byStatus = (status: 'open' | 'won' | 'lost') =>
      owners === 'all'
        ? statusTotals(ctx, pipeline._id, status)
        : scopedStatusTotals(ctx, owners, pipeline._id, status);
    const stages = [];
    for (const stage of pipeline.stages) {
      stages.push({ ...stage, ...(await byStage(stage.key)) });
    }
    return {
      _id: pipeline._id,
      name: pipeline.name,
      isDefault: !!pipeline.isDefault,
      stages,
      open: await byStatus('open'),
      won: await byStatus('won'),
      lost: await byStatus('lost'),
    };
  },
});

export type DealRow = Doc<'deals'> & {
  leadName: string | null;
  ownerNames: string[];
  stageLabel: string;
  stageTagLabels: string[];
};

/** Attach the names a card/row displays (memoized point reads per page). */
async function withRelations(ctx: QueryCtx, deals: Doc<'deals'>[]): Promise<DealRow[]> {
  const leads = new Map<string, string | null>();
  const users = new Map<string, string | null>();
  const pipelines = new Map<string, Doc<'pipelines'> | null>();
  const nameOf = async <T extends 'leads' | 'companies' | 'users'>(
    cache: Map<string, string | null>,
    id: Id<T>,
    render: (doc: Doc<T>) => string,
  ) => {
    if (!cache.has(id)) {
      const doc = (await ctx.db.get(id)) as Doc<T> | null;
      cache.set(id, doc && isNotDeleted(doc as { deletedAt?: number }) ? render(doc) : null);
    }
    return cache.get(id) ?? null;
  };
  const out: DealRow[] = [];
  for (const deal of deals) {
    if (!pipelines.has(deal.pipelineId))
      pipelines.set(deal.pipelineId, await ctx.db.get(deal.pipelineId));
    const pipeline = pipelines.get(deal.pipelineId);
    const stage = pipeline ? pipelineStage(pipeline, deal.stageKey) : undefined;
    out.push({
      ...deal,
      leadName: deal.leadId
        ? await nameOf(leads, deal.leadId, (l) => `${l.firstName} ${l.lastName}`)
        : null,
      ownerNames: (
        await Promise.all(
          deal.ownerIds.map((id) => nameOf(users, id, (u) => `${u.firstName} ${u.lastName}`)),
        )
      ).filter((n): n is string => n !== null),
      stageLabel: stage?.label ?? deal.stageKey,
      stageTagLabels: stageTagLabels(stage, deal.stageTags),
    });
  }
  return out;
}

/** One Kanban column: the live deals of a stage, newest first, cursor-paginated. */
export const listStageDeals = employeeQuery({
  args: {
    pipelineId: v.id('pipelines'),
    stageKey: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('deals')
      .withIndex('by_pipeline_stage', (q) =>
        q.eq('pipelineId', args.pipelineId).eq('stageKey', args.stageKey),
      )
      .order('desc')
      .paginate(args.paginationOpts);
    return { ...result, page: await withRelations(ctx, result.page.filter(isNotDeleted)) };
  },
});

export const dealFilterArgs = {
  pipelineId: v.optional(v.id('pipelines')),
  stageKeys: v.optional(v.array(v.string())),
  statuses: v.optional(v.array(dealStatusValidator)),
  ownerIds: v.optional(v.array(v.id('users'))),
  leadIds: v.optional(v.array(v.id('leads'))),
  search: v.optional(v.string()),
  advancedFilter: v.optional(dealAdvancedFilterValidator),
} as const;

type DealFilters = {
  pipelineId?: Id<'pipelines'>;
  stageKeys?: string[];
  statuses?: Doc<'deals'>['status'][];
  ownerIds?: Id<'users'>[];
  leadIds?: Id<'leads'>[];
  search?: string;
  advancedFilter?: DealAdvancedFilter;
};

/** The deal binding of the shared advanced-filter evaluator (lib/filterMatching.ts). */
export function getDealFieldValue(
  deal: Doc<'deals'>,
  field: FilterField<DealStandardField>,
): PropertyValue | undefined {
  if (field.kind === 'custom') return deal.customProperties?.[field.definitionId];
  switch (field.field) {
    case 'title':
      return deal.title;
    case 'amount':
      return deal.amount;
    case 'currency':
      return deal.currency;
    case 'status':
      return deal.status;
    case 'stageKey':
      return deal.stageKey;
    case 'stageTags':
      return deal.stageTags ?? [];
    case 'ownerIds':
      return deal.ownerIds;
    case 'expectedCloseDate':
      return deal.expectedCloseDate;
    case 'createdAt':
      return deal._creationTime;
  }
}

function matchesDealFilters(deal: Doc<'deals'>, f: DealFilters): boolean {
  if (!isNotDeleted(deal)) return false;
  if (f.pipelineId && deal.pipelineId !== f.pipelineId) return false;
  if (f.stageKeys?.length && !f.stageKeys.includes(deal.stageKey)) return false;
  if (f.statuses?.length && !f.statuses.includes(deal.status)) return false;
  if (f.ownerIds?.length && !deal.ownerIds.some((id) => f.ownerIds?.includes(id))) return false;
  if (f.leadIds?.length && (!deal.leadId || !f.leadIds.includes(deal.leadId))) return false;
  const search = f.search ? normalizeSearchText(f.search) : '';
  if (search && !normalizeSearchText(deal.title).includes(search)) return false;
  if (f.advancedFilter && !evalFilter((field) => getDealFieldValue(deal, field), f.advancedFilter))
    return false;
  return true;
}

export const listDealsPaginated = employeeQuery({
  args: { paginationOpts: paginationOptsValidator, ...dealFilterArgs },
  handler: async (ctx, args) => {
    const one = <T>(list: T[] | undefined) => (list?.length === 1 ? list[0] : undefined);
    const lead = one(args.leadIds);
    const stage = one(args.stageKeys);
    const status = one(args.statuses);
    const pipelineId = args.pipelineId;
    const base = ctx.db.query('deals');
    const cursor =
      lead !== undefined
        ? base.withIndex('by_lead', (q) => q.eq('leadId', lead))
        : pipelineId !== undefined && stage !== undefined
          ? base.withIndex('by_pipeline_stage', (q) =>
              q.eq('pipelineId', pipelineId).eq('stageKey', stage),
            )
          : pipelineId !== undefined && status !== undefined
            ? base.withIndex('by_pipeline_status', (q) =>
                q.eq('pipelineId', pipelineId).eq('status', status),
              )
            : pipelineId !== undefined
              ? base.withIndex('by_pipeline_stage', (q) => q.eq('pipelineId', pipelineId))
              : base;
    const result = await cursor.order('desc').paginate(args.paginationOpts);
    return {
      ...result,
      page: await withRelations(
        ctx,
        result.page.filter((d) => matchesDealFilters(d, args)),
      ),
    };
  },
});

/** Deal page payload: the deal with names, its pipeline, and the stage history. */
export const getDeal = employeeQuery({
  args: { dealId: v.id('deals') },
  handler: async (ctx, args) => {
    const deal = await ctx.db.get(args.dealId);
    if (!deal || !isNotDeleted(deal)) return null;
    const [row] = await withRelations(ctx, [deal]);
    const pipeline = await ctx.db.get(deal.pipelineId);
    const campaign = deal.sourceCampaignId ? await ctx.db.get(deal.sourceCampaignId) : null;
    const history = await ctx.db
      .query('dealStageHistory')
      .withIndex('by_deal', (q) => q.eq('dealId', deal._id))
      .collect();
    const users = new Map<string, string | null>();
    const workflows = new Map<string, string | null>();
    const rows = [];
    for (const h of history) {
      if (h.changedBy && !users.has(h.changedBy)) {
        const u = await ctx.db.get(h.changedBy);
        users.set(h.changedBy, u ? `${u.firstName} ${u.lastName}` : null);
      }
      if (h.workflowId && !workflows.has(h.workflowId)) {
        workflows.set(h.workflowId, (await ctx.db.get(h.workflowId))?.name ?? null);
      }
      rows.push({
        _id: h._id,
        from: h.from ?? null,
        fromLabel: pipeline
          ? (pipelineStage(pipeline, h.from)?.label ?? h.from ?? null)
          : (h.from ?? null),
        to: h.to,
        toLabel: pipeline ? (pipelineStage(pipeline, h.to)?.label ?? h.to) : h.to,
        tags: stageTagLabels(pipeline ? pipelineStage(pipeline, h.to) : undefined, h.tags),
        comment: h.comment ?? null,
        source: h.source,
        changedAt: h._creationTime,
        changedByName: h.changedBy ? (users.get(h.changedBy) ?? null) : null,
        workflowName: h.workflowId ? (workflows.get(h.workflowId) ?? null) : null,
      });
    }
    return {
      deal: row,
      pipeline: pipeline && isNotDeleted(pipeline) ? pipeline : null,
      sourceCampaignName: campaign?.name ?? null,
      history: rows,
    };
  },
});

/** A lead's transactions (newest first, bounded) for the lead page. */
export const listDealsForEntity = employeeQuery({
  args: { leadId: v.id('leads') },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('deals')
      .withIndex('by_lead', (q) => q.eq('leadId', args.leadId))
      .order('desc')
      .take(50);
    return await withRelations(ctx, rows.filter(isNotDeleted));
  },
});
