import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { internalMutation, internalQuery } from '../../_generated/server';
import { API_IDEMPOTENCY_TTL_MS } from '../../_lib/validators/apiKeys';
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

/** Stale replay rows swept per reservation — keeps the table bounded without a cron. */
const IDEMPOTENCY_SWEEP_BATCH = 20;

/** Reserve an Idempotency-Key: replay a done row, refuse a different fingerprint, flag a pending one. */
export const beginIdempotentRequest = internalMutation({
  args: { apiKeyId: v.id('apiKeys'), key: v.string(), fingerprint: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(IDEMPOTENCY_SWEEP_BATCH);
    for (const row of stale) await ctx.db.delete(row._id);

    const existing = await ctx.db
      .query('apiIdempotencyKeys')
      .withIndex('by_apiKey_key', (q) => q.eq('apiKeyId', args.apiKeyId).eq('key', args.key))
      .first();
    if (existing && existing.expiresAt > now) {
      if (existing.fingerprint !== args.fingerprint) return { kind: 'mismatch' as const };
      if (existing.status === 'pending') return { kind: 'pending' as const };
      return {
        kind: 'replay' as const,
        status: existing.responseStatus ?? 200,
        body: existing.responseBody ?? 'null',
      };
    }
    if (existing) await ctx.db.delete(existing._id);
    const id = await ctx.db.insert('apiIdempotencyKeys', {
      apiKeyId: args.apiKeyId,
      key: args.key,
      fingerprint: args.fingerprint,
      status: 'pending',
      expiresAt: now + API_IDEMPOTENCY_TTL_MS,
    });
    return { kind: 'new' as const, id };
  },
});

export const finishIdempotentRequest = internalMutation({
  args: { id: v.id('apiIdempotencyKeys'), status: v.number(), body: v.string() },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.id))) return;
    await ctx.db.patch(args.id, {
      status: 'done',
      responseStatus: args.status,
      responseBody: args.body,
    });
  },
});

/** Drop a reservation whose request failed server-side, so the retry runs again. */
export const abandonIdempotentRequest = internalMutation({
  args: { id: v.id('apiIdempotencyKeys') },
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.id)) await ctx.db.delete(args.id);
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
    // Emails are stored lowercased (see crm/mutations normalizeEmail).
    const email = args.email?.trim().toLowerCase();
    const query =
      email === undefined
        ? ctx.db.query('leads').order('desc')
        : ctx.db.query('leads').withIndex('by_email', (q) => q.eq('email', email));
    const result = await query.paginate(args.paginationOpts);
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
    // Domains are stored lowercase without protocol/www (companies validator).
    const domain = args.domain?.trim().toLowerCase();
    const query =
      domain === undefined
        ? ctx.db.query('companies').order('desc')
        : ctx.db.query('companies').withIndex('by_domain', (q) => q.eq('domain', domain));
    const result = await query.paginate(args.paginationOpts);
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
    const leadId = args.leadId === undefined ? undefined : ctx.db.normalizeId('leads', args.leadId);
    if (leadId === null) return { data: [], nextCursor: null };
    const query =
      leadId === undefined
        ? ctx.db.query('deals').order('desc')
        : ctx.db.query('deals').withIndex('by_lead', (q) => q.eq('leadId', leadId));
    const result = await query.paginate(args.paginationOpts);
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
    const leadId = args.leadId === undefined ? undefined : ctx.db.normalizeId('leads', args.leadId);
    if (leadId === null) return { data: [], nextCursor: null };
    const query =
      leadId === undefined
        ? ctx.db.query('activities').order('desc')
        : ctx.db.query('activities').withIndex('by_lead', (q) => q.eq('leadId', leadId));
    const result = await query.paginate(args.paginationOpts);
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
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db.query('leadLists').paginate(args.paginationOpts);
    return page(result, toPublicList);
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
  args: { entityType: v.string(), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    if (!(PROPERTY_ENTITY_TYPES as readonly string[]).includes(args.entityType)) return null;
    const result = await ctx.db
      .query('propertyDefinitions')
      .withIndex('by_entityType', (q) => q.eq('entityType', args.entityType as PropertyEntityType))
      .paginate(args.paginationOpts);
    return page({ ...result, page: result.page.filter(isNotDeleted) }, toPublicPropertyDefinition);
  },
});
