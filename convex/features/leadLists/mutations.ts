import { refusal, refusalFrom } from '../../_lib/refusal';
import { v } from 'convex/values';
import { employeeMutation } from '../../_lib/auth';
import { internal } from '../../_generated/api';
import { createAuditFields, updateAuditFields, logAudit } from '../../lib/audit/log';
import { deleteListMember } from '../../lib/leadLists/members';
import { validateDynamicListCriteria } from '../../_lib/validators/leadLists';
import { leadAdvancedFilterValidator } from '../../_lib/validators/filters';
import { startDynamicListRecalc } from '../../lib/leadLists/dynamic';

export const createLeadList = employeeMutation({
  args: {
    name: v.string(),
    kind: v.optional(v.union(v.literal('static'), v.literal('dynamic'))),
    criteria: v.optional(leadAdvancedFilterValidator),
  },
  returns: v.id('leadLists'),
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw refusal('list_name_required', { message: 'Le nom de la liste est requis.' });
    const kind = args.kind ?? 'static';

    if (kind === 'dynamic') {
      const error = validateDynamicListCriteria(args.criteria);
      if (error) throw refusalFrom(error, 'invalid_list_criteria');
      const { maxDynamicLists, dynamicCount }: { maxDynamicLists: number; dynamicCount: number } =
        await ctx.runQuery(internal.features.leadLists.internal.dynamicListLimits, {});
      if (dynamicCount >= maxDynamicLists) throw refusal('dynamic_list_cap_reached');
    } else if (args.criteria) {
      throw refusal('list_not_dynamic');
    }

    const listId = await ctx.db.insert('leadLists', {
      name,
      ...(kind === 'dynamic' && { kind, criteria: args.criteria }),
      ...createAuditFields(ctx.userId),
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: listId,
      action: 'create',
      metadata: { kind },
    });

    if (kind === 'dynamic') {
      const list = await ctx.db.get(listId);
      if (list) await startDynamicListRecalc(ctx, list);
    }
    return listId;
  },
});

export const updateLeadList = employeeMutation({
  args: {
    listId: v.id('leadLists'),
    name: v.optional(v.string()),
    criteria: v.optional(leadAdvancedFilterValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw refusal('list_not_found');

    const name = args.name?.trim();
    if (name !== undefined && !name) {
      throw refusal('list_name_required', { message: 'Le nom de la liste est requis.' });
    }
    if (args.criteria) {
      if (list.kind !== 'dynamic') throw refusal('list_not_dynamic');
      const error = validateDynamicListCriteria(args.criteria);
      if (error) throw refusalFrom(error, 'invalid_list_criteria');
    }

    await ctx.db.patch(args.listId, {
      ...(name !== undefined && { name }),
      ...(args.criteria !== undefined && { criteria: args.criteria }),
      ...updateAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: args.listId,
      action: 'update',
      metadata: { criteriaChanged: args.criteria !== undefined },
    });

    if (args.criteria !== undefined) {
      const fresh = await ctx.db.get(args.listId);
      if (fresh) await startDynamicListRecalc(ctx, fresh);
    }
    return null;
  },
});

export const recalcLeadList = employeeMutation({
  args: { listId: v.id('leadLists') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) throw refusal('list_not_found');
    if (list.kind !== 'dynamic') throw refusal('list_not_dynamic');
    await startDynamicListRecalc(ctx, list);
    return null;
  },
});

// Each cascade-deleted lead writes up to 3 docs plus a few aggregate nodes: 200 members stay well under Convex's per-transaction write cap.
const LIST_DELETE_BATCH = 200;

/** Members go in bounded batches to stay under Convex's per-transaction limits: the client calls again until `done`, when the list itself is removed. */
export const deleteLeadList = employeeMutation({
  args: { listId: v.id('leadLists'), deleteLeads: v.boolean() },
  returns: v.union(
    v.object({ done: v.literal(true), deletedLeads: v.number() }),
    v.object({ done: v.literal(false), deletedLeads: v.number() }),
  ),
  handler: async (ctx, args) => {
    const list = await ctx.db.get(args.listId);
    if (!list) return { done: true as const, deletedLeads: 0 };
    if (list.nextRecalcId) {
      await ctx.scheduler.cancel(list.nextRecalcId);
      await ctx.db.patch(args.listId, { nextRecalcId: undefined, recalc: undefined });
    }

    const members = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', args.listId))
      .take(LIST_DELETE_BATCH);

    let deletedLeads = 0;
    for (const member of members) {
      // Junction row first: the soft-delete trigger below would otherwise delete it too.
      await deleteListMember(ctx, member);
      if (args.deleteLeads) {
        const lead = await ctx.db.get(member.leadId);
        if (lead && lead.deletedAt == null) {
          await ctx.db.patch(member.leadId, {
            deletedAt: Date.now(),
            ...updateAuditFields(ctx.userId),
          });
          await logAudit({
            ctx,
            userId: ctx.userId,
            entityType: 'lead',
            entityId: member.leadId,
            action: 'delete',
          });
          deletedLeads++;
        }
      }
    }

    // More members remain — signal the client to call again.
    if (members.length === LIST_DELETE_BATCH) {
      return { done: false as const, deletedLeads };
    }

    // All members processed: remove the list itself.
    await ctx.db.delete(args.listId);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'leadList',
      entityId: args.listId,
      action: 'delete',
    });
    return { done: true as const, deletedLeads };
  },
});
