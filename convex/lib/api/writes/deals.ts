import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { createDealRecord, moveDealToStage, validateDealFields } from '../../deals/records';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../properties/definitions';
import type { DealCreateBody, DealPatchBody } from '../bodies';
import { toPublicDeal } from '../dtos';
import { apiError } from '../errors';
import {
  applyPatch,
  mergeCustomProperties,
  ref,
  refs,
  requireKnownProperties,
  softDelete,
  target,
} from './common';

export async function createDeal(ctx: MutationCtx, apiKeyId: Id<'apiKeys'>, body: DealCreateBody) {
  const fields = {
    ...body,
    pipelineId: body.pipelineId ? ref(ctx, 'pipelines', body.pipelineId, 'pipelineId') : undefined,
    leadId: body.leadId ? ref(ctx, 'leads', body.leadId, 'leadId') : undefined,
    sourceCampaignId: body.sourceCampaignId
      ? ref(ctx, 'campaigns', body.sourceCampaignId, 'sourceCampaignId')
      : undefined,
    ownerIds: body.ownerIds ? refs(ctx, 'users', body.ownerIds, 'ownerIds') : undefined,
  };
  await validateDealFields(ctx, fields);
  const defs = await loadPropertyDefsById(ctx, 'deal');
  requireKnownProperties(defs, body.customProperties);
  const dealId = await createDealRecord(
    ctx,
    { ...fields, customProperties: sanitizeCustomProperties(defs, body.customProperties) },
    { source: 'api', apiKeyId },
  );
  return toPublicDeal((await ctx.db.get(dealId))!);
}

/** Field edits, then the stage move — through the transition graph, like a Kanban drop. */
export async function updateDeal(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  id: string,
  body: DealPatchBody,
) {
  const deal = await target(ctx, 'deals', id);
  if (body.stageKey === undefined && (body.stageTags || body.stageComment !== undefined)) {
    throw apiError(400, 'invalid_fields', 'stageTags and stageComment need a stageKey.', {
      path: '.stageTags',
    });
  }
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = body.title.trim();
  if (body.amount !== undefined) updates.amount = body.amount;
  if (body.currency !== undefined) updates.currency = body.currency.toUpperCase();
  if (body.expectedCloseDate !== undefined) updates.expectedCloseDate = body.expectedCloseDate;
  if (body.ownerIds !== undefined) {
    updates.ownerIds = refs(ctx, 'users', body.ownerIds, 'ownerIds');
  }
  if (body.leadId !== undefined) {
    updates.leadId = body.leadId === null ? null : ref(ctx, 'leads', body.leadId, 'leadId');
  }
  if (body.sourceCampaignId !== undefined) {
    updates.sourceCampaignId =
      body.sourceCampaignId === null
        ? null
        : ref(ctx, 'campaigns', body.sourceCampaignId, 'sourceCampaignId');
  }
  await validateDealFields(
    ctx,
    Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== null)) as Parameters<
      typeof validateDealFields
    >[1],
  );
  if (body.customProperties !== undefined) {
    updates.customProperties = mergeCustomProperties(
      await loadPropertyDefsById(ctx, 'deal'),
      deal.customProperties,
      body.customProperties,
    );
  }

  await applyPatch(ctx, apiKeyId, 'deals', deal, updates);
  if (body.stageKey !== undefined) {
    const fresh = (await ctx.db.get(deal._id))!;
    const move = await moveDealToStage(
      ctx,
      fresh,
      body.stageKey,
      { source: 'api', apiKeyId },
      { tags: body.stageTags, comment: body.stageComment },
    );
    if (move.kind === 'unknown_stage') throw new Error('unknown_stage');
    if (move.kind === 'unknown_tag') throw new Error('unknown_stage_tag');
    if (move.kind === 'tag_required') throw new Error('stage_tag_required');
    if (move.kind === 'forbidden') throw new Error('deal_transition_forbidden');
  }
  return toPublicDeal((await ctx.db.get(deal._id))!);
}

export async function deleteDeal(ctx: MutationCtx, apiKeyId: Id<'apiKeys'>, id: string) {
  await softDelete(ctx, apiKeyId, 'deals', id);
  return null;
}
