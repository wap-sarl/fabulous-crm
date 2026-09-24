import type { Doc, Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { defaultPipelineStage, type PipelineStage } from '../../../_lib/validators/deals';
import type { DealImportRow } from '../../../_lib/validators/imports';
import type { PropertyValue } from '../../../_lib/validators/properties';
import { computeChanges, logAudit, updateAuditFields } from '../../../lib/audit';
import { filterUndefined, isNotDeleted } from '../../../lib/dbHelpers';
import {
  createDealRecord,
  defaultPipeline,
  listLivePipelines,
  moveDealToStage,
  validateDealFields,
} from '../../../lib/deals';
import { findLeadByEmail, normalizeEmail } from '../../../lib/leadImport';
import { cleanOwnerIds } from '../../../lib/owners';
import {
  loadPropertyDefsById,
  type PropertyDefinitionDoc,
  sanitizeCustomProperties,
} from '../../../lib/properties';
import type { EntityImporter } from './types';

interface Caches {
  propertyDefsById: Map<string, PropertyDefinitionDoc>;
  pipelines: Doc<'pipelines'>[];
  defaultPipeline: Doc<'pipelines'> | null;
  // Contacts looked up by email, memoized across the batch.
  leadByEmail: Map<string, Doc<'leads'> | null>;
}

interface Resolved {
  title: string;
  pipeline: Doc<'pipelines'>;
  stage: PipelineStage | undefined;
  leadId: Id<'leads'> | undefined;
  customProperties: Record<string, PropertyValue> | undefined;
}

type State =
  | { kind: 'error'; error: string }
  | ({ kind: 'create' } & Resolved)
  | ({ kind: 'update'; deal: Doc<'deals'> } & Resolved);

const fold = (s: string) => s.trim().toLowerCase();

/** The pipeline named in the row, else the default one; a stage by its label or key inside it. */
function resolvePipeline(
  caches: Caches,
  row: DealImportRow,
): { pipeline: Doc<'pipelines'>; stage: PipelineStage | undefined } {
  const pipeline = row.pipeline?.trim()
    ? caches.pipelines.find((p) => fold(p.name) === fold(row.pipeline ?? ''))
    : caches.defaultPipeline;
  if (!pipeline) throw new Error('pipeline_not_found');
  if (!row.stage?.trim()) return { pipeline, stage: undefined };
  const stage = pipeline.stages.find(
    (s) => fold(s.label) === fold(row.stage ?? '') || s.key === row.stage,
  );
  if (!stage) throw new Error('unknown_stage');
  return { pipeline, stage };
}

async function leadOf(ctx: MutationCtx, caches: Caches, email: string): Promise<Doc<'leads'>> {
  if (!caches.leadByEmail.has(email))
    caches.leadByEmail.set(email, await findLeadByEmail(ctx, email));
  const lead = caches.leadByEmail.get(email);
  if (!lead || !isNotDeleted(lead)) throw new Error('contact_not_found');
  return lead;
}

/** The live deal of that contact with the same title: a file imported twice updates rather than doubles. */
async function matchDeal(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  title: string,
): Promise<Doc<'deals'> | null> {
  const deals = await ctx.db
    .query('deals')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(200);
  return deals.find((d) => isNotDeleted(d) && fold(d.title) === fold(title)) ?? null;
}

export const dealImporter: EntityImporter<DealImportRow, Caches, State> = {
  loadCaches: async (ctx) => ({
    propertyDefsById: await loadPropertyDefsById(ctx, 'deal'),
    pipelines: await listLivePipelines(ctx),
    defaultPipeline: await defaultPipeline(ctx),
    leadByEmail: new Map(),
  }),
  plan: async (ctx, row, caches, opts) => {
    try {
      const title = row.title.trim();
      if (!title) throw new Error('deal_title_required');
      await validateDealFields(ctx, {
        amount: row.amount,
        currency: row.currency,
        expectedCloseDate: row.expectedCloseDate,
        ownerIds: row.ownerIds,
      });
      const { pipeline, stage } = resolvePipeline(caches, row);
      const email = normalizeEmail(row.contactEmail);
      const leadId = email ? (await leadOf(ctx, caches, email))._id : undefined;
      const customProperties = sanitizeCustomProperties(
        caches.propertyDefsById,
        row.customProperties,
      );
      const resolved: Resolved = { title, pipeline, stage, leadId, customProperties };
      const matched = opts.matchId ? await ctx.db.get(opts.matchId as Id<'deals'>) : null;
      // Without a contact there is no key to match on: the row is a new deal.
      const deal = matched ?? (leadId ? await matchDeal(ctx, leadId, title) : null);
      if (deal) {
        return {
          verdict: { kind: 'update', id: deal._id, label: deal.title },
          state: { kind: 'update', deal, ...resolved },
        };
      }
      return { verdict: { kind: 'create' }, state: { kind: 'create', ...resolved } };
    } catch (e) {
      const error = e instanceof Error ? e.message : 'invalid_row';
      return { verdict: { kind: 'error', error }, state: { kind: 'error', error } };
    }
  },
  apply: async (ctx, row, state, _caches, actor) => {
    if (state.kind === 'error') return state;
    const { userId } = actor;
    const meta = { source: 'manual' as const, changedBy: userId };
    if (state.kind === 'update') {
      const { deal } = state;
      // The stage moves through the one path that enforces the pipeline's transitions; a refused move is a row error.
      if (state.stage && state.stage.key !== deal.stageKey) {
        if (state.pipeline._id !== deal.pipelineId)
          return { kind: 'error', error: 'deal_in_other_pipeline' };
        const move = await moveDealToStage(ctx, deal, state.stage.key, meta);
        if (move.kind !== 'moved' && move.kind !== 'unchanged')
          return { kind: 'error', error: `stage_move_${move.kind}` };
      }
      const updates: Record<string, unknown> = filterUndefined({
        title: state.title,
        amount: row.amount,
        currency: row.currency?.toUpperCase(),
        expectedCloseDate: row.expectedCloseDate,
        ownerIds: row.ownerIds ? await cleanOwnerIds(ctx, row.ownerIds) : undefined,
      });
      if (state.customProperties && Object.keys(state.customProperties).length) {
        updates.customProperties = { ...deal.customProperties, ...state.customProperties };
      }
      const changes = computeChanges(deal, updates);
      await ctx.db.patch(deal._id, { ...updates, ...updateAuditFields(userId) });
      if (changes) {
        await logAudit({
          ctx,
          userId,
          entityType: 'deal',
          entityId: deal._id,
          action: 'update',
          metadata: { changes, source: 'import' },
        });
      }
      return { kind: 'updated', id: deal._id };
    }
    const dealId = await createDealRecord(
      ctx,
      {
        title: state.title,
        amount: row.amount,
        currency: row.currency?.toUpperCase(),
        pipelineId: state.pipeline._id,
        stageKey: (state.stage ?? defaultPipelineStage(state.pipeline))?.key,
        expectedCloseDate: row.expectedCloseDate,
        ownerIds: row.ownerIds?.length ? await cleanOwnerIds(ctx, row.ownerIds) : [userId],
        leadId: state.leadId,
        customProperties: state.customProperties,
      },
      { source: 'create', changedBy: userId },
    );
    return { kind: 'created', id: dealId };
  },
};
