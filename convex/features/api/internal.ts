import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { internalMutation, internalQuery } from '../../_generated/server';
import { PROPERTY_ENTITY_TYPES, type PropertyEntityType } from '../../_lib/validators/properties';
import { API_KEY_TOUCH_INTERVAL_MS } from '../../lib/apiAuth';
import {
  toPublicActivity,
  toPublicCompany,
  toPublicContact,
  toPublicDeal,
  toPublicList,
  toPublicPropertyDefinition,
} from '../../lib/apiDtos';
import { isNotDeleted } from '../../lib/dbHelpers';

export const getApiKeyByKeyId = internalQuery({
  args: { keyId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('apiKeys')
      .withIndex('by_keyId', (q) => q.eq('keyId', args.keyId))
      .first();
  },
});

// apiKeys is not a triggered table: the raw internalMutation is enough.
export const touchApiKey = internalMutation({
  args: { id: v.id('apiKeys') },
  handler: async (ctx, args) => {
    const key = await ctx.db.get(args.id);
    if (!key) return;
    const now = Date.now();
    if (key.lastUsedAt === undefined || now - key.lastUsedAt >= API_KEY_TOUCH_INTERVAL_MS) {
      await ctx.db.patch(args.id, { lastUsedAt: now });
    }
  },
});

const page = <T, U>(
  result: { page: T[]; isDone: boolean; continueCursor: string },
  map: (doc: T) => U,
) => ({
  // Soft-deleted rows are dropped after pagination, so a page may run short of
  // the requested limit — the cursor, not data.length, signals the end.
  data: result.page.map(map),
  nextCursor: result.isDone ? null : result.continueCursor,
});

export const listContacts = internalQuery({
  args: { paginationOpts: paginationOptsValidator, email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.email !== undefined) {
      // Emails are stored lowercased (see crm/mutations normalizeEmail).
      const email = args.email.trim().toLowerCase();
      const rows = await ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', email))
        .collect();
      return { data: rows.filter(isNotDeleted).map(toPublicContact), nextCursor: null };
    }
    const result = await ctx.db.query('leads').order('desc').paginate(args.paginationOpts);
    return page({ ...result, page: result.page.filter(isNotDeleted) }, toPublicContact);
  },
});

export const getContact = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('leads', args.id);
    const lead = id ? await ctx.db.get(id) : null;
    return lead && isNotDeleted(lead) ? toPublicContact(lead) : null;
  },
});

export const listCompanies = internalQuery({
  args: { paginationOpts: paginationOptsValidator, domain: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.domain !== undefined) {
      // Domains are stored lowercase without protocol/www (companies validator).
      const domain = args.domain.trim().toLowerCase();
      const rows = await ctx.db
        .query('companies')
        .withIndex('by_domain', (q) => q.eq('domain', domain))
        .collect();
      return { data: rows.filter(isNotDeleted).map(toPublicCompany), nextCursor: null };
    }
    const result = await ctx.db.query('companies').order('desc').paginate(args.paginationOpts);
    return page({ ...result, page: result.page.filter(isNotDeleted) }, toPublicCompany);
  },
});

export const getCompany = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('companies', args.id);
    const company = id ? await ctx.db.get(id) : null;
    return company && isNotDeleted(company) ? toPublicCompany(company) : null;
  },
});

export const listDeals = internalQuery({
  args: { paginationOpts: paginationOptsValidator, leadId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.leadId !== undefined) {
      const leadId = ctx.db.normalizeId('leads', args.leadId);
      if (!leadId) return { data: [], nextCursor: null };
      const rows = await ctx.db
        .query('deals')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect();
      return { data: rows.filter(isNotDeleted).map(toPublicDeal), nextCursor: null };
    }
    const result = await ctx.db.query('deals').order('desc').paginate(args.paginationOpts);
    return page({ ...result, page: result.page.filter(isNotDeleted) }, toPublicDeal);
  },
});

export const getDeal = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('deals', args.id);
    const deal = id ? await ctx.db.get(id) : null;
    return deal && isNotDeleted(deal) ? toPublicDeal(deal) : null;
  },
});

export const listActivities = internalQuery({
  args: { paginationOpts: paginationOptsValidator, leadId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.leadId !== undefined) {
      const leadId = ctx.db.normalizeId('leads', args.leadId);
      if (!leadId) return { data: [], nextCursor: null };
      const rows = await ctx.db
        .query('activities')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect();
      return { data: rows.filter(isNotDeleted).map(toPublicActivity), nextCursor: null };
    }
    const result = await ctx.db.query('activities').order('desc').paginate(args.paginationOpts);
    return page({ ...result, page: result.page.filter(isNotDeleted) }, toPublicActivity);
  },
});

export const getActivity = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId('activities', args.id);
    const activity = id ? await ctx.db.get(id) : null;
    return activity && isNotDeleted(activity) ? toPublicActivity(activity) : null;
  },
});

export const listLists = internalQuery({
  args: {},
  handler: async (ctx) => {
    const lists = await ctx.db.query('leadLists').collect();
    return { data: lists.map(toPublicList), nextCursor: null };
  },
});

export const listListMembers = internalQuery({
  args: { listId: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const listId = ctx.db.normalizeId('leadLists', args.listId);
    const list = listId ? await ctx.db.get(listId) : null;
    if (!list || !listId) return null;
    const result = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', listId))
      .paginate(args.paginationOpts);
    const leads = await Promise.all(result.page.map((m) => ctx.db.get(m.leadId)));
    return page(
      { ...result, page: leads.filter((l): l is Doc<'leads'> => l !== null && isNotDeleted(l)) },
      toPublicContact,
    );
  },
});

export const listProperties = internalQuery({
  args: { entityType: v.string() },
  handler: async (ctx, args) => {
    if (!(PROPERTY_ENTITY_TYPES as readonly string[]).includes(args.entityType)) return null;
    const defs = await ctx.db
      .query('propertyDefinitions')
      .withIndex('by_entityType', (q) => q.eq('entityType', args.entityType as PropertyEntityType))
      .collect();
    return {
      data: defs.filter(isNotDeleted).map(toPublicPropertyDefinition),
      nextCursor: null,
    };
  },
});
