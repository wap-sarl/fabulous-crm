import { v } from 'convex/values';
import { settingsMutation } from '../../_lib/auth';
import { refusal } from '../../_lib/refusal';
import { follows } from '../../_lib/validators/fields';
import { marketingConsentChannelValidator } from '../../_lib/validators/crm';
import {
  legalBasisValidator,
  subscriptionDescriptionSchema,
  subscriptionNameSchema,
} from '../../_lib/validators/subscriptions';
import { createAuditFields, logAudit, updateAuditFields } from '../../lib/audit/log';
import { ensureDefaultSubscriptionTypes, loadSubscriptionTypes } from '../../lib/consent/types';

function checkName(name: string): string {
  if (!follows(subscriptionNameSchema, name)) throw refusal('subscription_name_invalid');
  return name.trim();
}

function checkDescription(description: string | undefined): string | undefined {
  if (description === undefined) return undefined;
  if (!follows(subscriptionDescriptionSchema, description)) {
    throw refusal('subscription_description_invalid');
  }
  return description.trim() || undefined;
}

export const createSubscriptionType = settingsMutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    channel: marketingConsentChannelValidator,
    legalBasis: legalBasisValidator,
    active: v.boolean(),
  },
  returns: v.id('subscriptionTypes'),
  handler: async (ctx, args) => {
    const name = checkName(args.name);
    const types = await loadSubscriptionTypes(ctx);
    const typeId = await ctx.db.insert('subscriptionTypes', {
      name,
      description: checkDescription(args.description),
      channel: args.channel,
      legalBasis: args.legalBasis,
      active: args.active,
      order: (types[types.length - 1]?.order ?? -1) + 1,
      ...createAuditFields(ctx.userId),
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'subscriptionType',
      entityId: typeId,
      action: 'create',
      metadata: { name, channel: args.channel, legalBasis: args.legalBasis },
    });
    return typeId;
  },
});

/** The channel and the legal basis are set for good: the consents collected under them would say something else. */
export const updateSubscriptionType = settingsMutation({
  args: {
    typeId: v.id('subscriptionTypes'),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const type = await ctx.db.get(args.typeId);
    if (!type) throw refusal('subscription_type_not_found');
    const patch: Partial<typeof type> = {};
    if (args.name !== undefined) patch.name = checkName(args.name);
    if (args.description !== undefined) patch.description = checkDescription(args.description);
    if (args.active !== undefined) patch.active = args.active;
    await ctx.db.patch(args.typeId, { ...patch, ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'subscriptionType',
      entityId: args.typeId,
      action: 'update',
      metadata: patch,
    });
    return null;
  },
});

/** The type goes; the choices and the events that name it stay, shown as a type that was. */
export const deleteSubscriptionType = settingsMutation({
  args: { typeId: v.id('subscriptionTypes') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const type = await ctx.db.get(args.typeId);
    if (!type) throw refusal('subscription_type_not_found');
    await ctx.db.delete(args.typeId);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'subscriptionType',
      entityId: args.typeId,
      action: 'delete',
      metadata: { name: type.name },
    });
    return null;
  },
});

export const reorderSubscriptionTypes = settingsMutation({
  args: { typeIds: v.array(v.id('subscriptionTypes')) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const types = await loadSubscriptionTypes(ctx);
    const known = new Set(types.map((type) => type._id));
    if (args.typeIds.length !== known.size || !args.typeIds.every((id) => known.has(id))) {
      throw refusal('invalid_subscription_order');
    }
    for (const [order, typeId] of args.typeIds.entries()) {
      await ctx.db.patch(typeId, { order, ...updateAuditFields(ctx.userId) });
    }
    return null;
  },
});

/** The shipped types, for a deployment set up before they existed; nothing when any type exists. */
export const ensureDefaults = settingsMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ensureDefaultSubscriptionTypes(ctx, ctx.userId)).length,
});
