import { refusal } from '../../../_lib/refusal';
import type { Id } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { createActivityRecord, requireActivityLinks } from '../../activities/records';
import { loadPropertyDefsById, sanitizeCustomProperties } from '../../properties/definitions';
import { isNotDeleted } from '../../shared/db';
import type { ActivityCreateBody, ActivityPatchBody } from '../bodies';
import { toPublicActivity } from '../dtos';
import {
  applyPatch,
  mergeCustomProperties,
  ref,
  requireKnownProperties,
  softDelete,
  target,
} from './common';

async function activityOwner(
  ctx: MutationCtx,
  raw: string | undefined,
): Promise<Id<'users'> | undefined> {
  if (raw === undefined) return undefined;
  const ownerId = ref(ctx, 'users', raw, 'ownerId');
  const user = await ctx.db.get(ownerId);
  if (user?.type !== 'employee' || !isNotDeleted(user)) throw refusal('invalid_owner');
  return ownerId;
}

async function activityTeam(
  ctx: MutationCtx,
  raw: string | undefined,
): Promise<Id<'teams'> | undefined> {
  if (raw === undefined) return undefined;
  const teamId = ref(ctx, 'teams', raw, 'teamId');
  const team = await ctx.db.get(teamId);
  if (!team || !isNotDeleted(team)) throw refusal('team_not_found');
  return teamId;
}

export async function createActivity(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  body: ActivityCreateBody,
) {
  const defs = await loadPropertyDefsById(ctx, 'activity');
  requireKnownProperties(defs, body.customProperties);
  const activityId = await createActivityRecord(
    ctx,
    {
      type: body.type,
      title: body.title,
      description: body.description,
      dueAt: body.dueAt,
      status: body.status,
      ownerId: await activityOwner(ctx, body.ownerId),
      teamId: await activityTeam(ctx, body.teamId),
      leadId: body.leadId ? ref(ctx, 'leads', body.leadId, 'leadId') : undefined,
      companyId: body.companyId ? ref(ctx, 'companies', body.companyId, 'companyId') : undefined,
      dealId: body.dealId ? ref(ctx, 'deals', body.dealId, 'dealId') : undefined,
      outcome: body.outcome,
      customProperties: sanitizeCustomProperties(defs, body.customProperties),
    },
    { apiKeyId },
  );
  return toPublicActivity((await ctx.db.get(activityId))!);
}

export async function updateActivity(
  ctx: MutationCtx,
  apiKeyId: Id<'apiKeys'>,
  id: string,
  body: ActivityPatchBody,
) {
  const activity = await target(ctx, 'activities', id);
  const updates: Record<string, unknown> = {};
  if (body.type !== undefined) updates.type = body.type;
  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) throw refusal('activity_title_required');
    updates.title = title;
  }
  if (body.description !== undefined) updates.description = body.description?.trim() || null;
  if (body.dueAt !== undefined) updates.dueAt = body.dueAt;
  if (body.outcome !== undefined) updates.outcome = body.outcome?.trim() || null;
  if (body.ownerId !== undefined) {
    updates.ownerId = body.ownerId === null ? null : await activityOwner(ctx, body.ownerId);
  }
  if (body.teamId !== undefined) {
    updates.teamId = body.teamId === null ? null : await activityTeam(ctx, body.teamId);
  }
  const links = {
    leadId: body.leadId ? ref(ctx, 'leads', body.leadId, 'leadId') : undefined,
    companyId: body.companyId ? ref(ctx, 'companies', body.companyId, 'companyId') : undefined,
    dealId: body.dealId ? ref(ctx, 'deals', body.dealId, 'dealId') : undefined,
  };
  await requireActivityLinks(ctx, links);
  if (body.leadId !== undefined) updates.leadId = links.leadId ?? null;
  if (body.companyId !== undefined) updates.companyId = links.companyId ?? null;
  if (body.dealId !== undefined) updates.dealId = links.dealId ?? null;
  if (body.status !== undefined && body.status !== activity.status) {
    updates.status = body.status;
    // Completion stamps completedAt; reopening clears it (like completeActivity / reopenActivity).
    if (body.status === 'done') updates.completedAt = Date.now();
    else if (body.status === 'open') updates.completedAt = null;
  }
  if (body.customProperties !== undefined) {
    updates.customProperties = mergeCustomProperties(
      await loadPropertyDefsById(ctx, 'activity'),
      activity.customProperties,
      body.customProperties,
    );
  }

  await applyPatch(ctx, apiKeyId, 'activities', activity, updates);
  return toPublicActivity((await ctx.db.get(activity._id))!);
}

export async function deleteActivity(ctx: MutationCtx, apiKeyId: Id<'apiKeys'>, id: string) {
  await softDelete(ctx, apiKeyId, 'activities', id);
  return null;
}
