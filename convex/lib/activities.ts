import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ActivityStatus, ActivityType } from '../_lib/validators/activities';
import type { PropertyValue } from '../_lib/validators/properties';
import { logAudit } from './audit';
import { isNotDeleted } from './dbHelpers';

export type NewActivity = {
  type: ActivityType;
  title: string;
  description?: string;
  dueAt?: number;
  status?: ActivityStatus;
  ownerId: Id<'users'>;
  leadId?: Id<'leads'>;
  companyId?: Id<'companies'>;
  dealId?: Id<'deals'>;
  outcome?: string;
  customProperties?: Record<string, PropertyValue>;
};

/** Assert the linked records are live; throws `<entity>_not_found`. */
export async function requireActivityLinks(
  ctx: MutationCtx,
  links: Pick<NewActivity, 'leadId' | 'companyId' | 'dealId'>,
): Promise<void> {
  if (links.leadId) {
    const lead = await ctx.db.get(links.leadId);
    if (!lead || !isNotDeleted(lead)) throw new Error('lead_not_found');
  }
  if (links.companyId) {
    const company = await ctx.db.get(links.companyId);
    if (!company || !isNotDeleted(company)) throw new Error('company_not_found');
  }
  if (links.dealId) {
    const deal = await ctx.db.get(links.dealId);
    if (!deal || !isNotDeleted(deal)) throw new Error('deal_not_found');
  }
}

/**
 * Insert an activity. `done` activities (a logged call, a note) get their
 * `completedAt` stamped now. Audited when a user is behind the creation.
 */
export async function createActivityRecord(
  ctx: MutationCtx,
  data: NewActivity,
  meta: { changedBy?: Id<'users'>; workflowId?: Id<'workflows'> },
): Promise<Id<'activities'>> {
  const title = data.title.trim();
  if (!title) throw new Error('activity_title_required');
  await requireActivityLinks(ctx, data);
  const status = data.status ?? 'open';
  const now = Date.now();
  const activityId = await ctx.db.insert('activities', {
    type: data.type,
    title,
    description: data.description?.trim() || undefined,
    dueAt: data.dueAt,
    status,
    ownerId: data.ownerId,
    leadId: data.leadId,
    companyId: data.companyId,
    dealId: data.dealId,
    outcome: data.outcome?.trim() || undefined,
    customProperties: data.customProperties,
    completedAt: status === 'done' ? now : undefined,
    updatedAt: now,
    createdBy: meta.changedBy,
    updatedBy: meta.changedBy,
  });
  if (meta.changedBy) {
    await logAudit({
      ctx,
      userId: meta.changedBy,
      entityType: 'activity',
      entityId: activityId,
      action: 'create',
      metadata: { type: data.type, status, workflowId: meta.workflowId },
    });
  }
  return activityId;
}

/** A live activity, or throw. */
export async function loadActivity(
  ctx: MutationCtx,
  activityId: Id<'activities'>,
): Promise<Doc<'activities'>> {
  const activity = await ctx.db.get(activityId);
  if (!activity || !isNotDeleted(activity)) throw new Error('activity_not_found');
  return activity;
}
