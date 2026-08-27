import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
// Trigger-wrapped constructor: keeps aggregates, searchText and dedupe keys in sync.
import { internalMutation } from '../../_lib/functions';
import { isNotDeleted } from '../../lib';
import {
  compareIdentities,
  dedupeKeys,
  findDuplicateCandidates,
  identityOf,
  repointLeadRows,
} from '../../lib/duplicates';

/** Leads examined per scan step (each reads up to three bounded index ranges). */
const SCAN_BATCH = 25;

/** Insert or refresh the pair row of two leads; returns true when it is new. */
async function upsertPair(
  ctx: MutationCtx,
  scanId: Id<'duplicateScans'>,
  a: Doc<'leads'>,
  b: Doc<'leads'>,
): Promise<boolean> {
  const [leadAId, leadBId] = a._id < b._id ? [a._id, b._id] : [b._id, a._id];
  const { reasons, score } = compareIdentities(identityOf(a), identityOf(b));
  if (reasons.length === 0) return false;
  const existing = await ctx.db
    .query('leadDuplicates')
    .withIndex('by_pair', (q) => q.eq('leadAId', leadAId).eq('leadBId', leadBId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { reasons, score, scanId, updatedAt: Date.now() });
    return false;
  }
  await ctx.db.insert('leadDuplicates', {
    leadAId,
    leadBId,
    reasons,
    score,
    status: 'open',
    scanId,
    updatedAt: Date.now(),
  });
  return true;
}

export const scanDuplicatesBatch = internalMutation({
  args: { scanId: v.id('duplicateScans'), cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string | null }> => {
    const scan = await ctx.db.get(args.scanId);
    if (scan?.status !== 'running') return { isDone: true, continueCursor: null };

    const page = await ctx.db
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: SCAN_BATCH });

    let found = 0;
    let scanned = 0;
    for (const lead of page.page) {
      if (!isNotDeleted(lead)) continue;
      scanned++;
      let current = lead;
      if (!lead.dedupe) {
        // The trigger stamps the keys on any write; an empty patch is enough.
        await ctx.db.patch(lead._id, { dedupe: dedupeKeys(lead) });
        current = { ...lead, dedupe: dedupeKeys(lead) };
      }
      const candidates = await findDuplicateCandidates(ctx, identityOf(current), lead._id);
      for (const candidate of candidates) {
        if (await upsertPair(ctx, args.scanId, current, candidate)) found++;
      }
    }

    await ctx.db.patch(args.scanId, {
      scanned: scan.scanned + scanned,
      found: scan.found + found,
      cursor: page.isDone ? undefined : page.continueCursor,
      ...(page.isDone ? { status: 'done' as const, finishedAt: Date.now() } : {}),
    });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.features.duplicates.internal.scanDuplicatesBatch, {
        scanId: args.scanId,
        cursor: page.continueCursor,
      });
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Continuation of a merge whose related rows exceeded one batch. */
export const repointMergedLead = internalMutation({
  args: { absorbedId: v.id('leads'), survivorId: v.id('leads') },
  handler: async (ctx, args): Promise<{ isDone: boolean }> => {
    const { moreLeft } = await repointLeadRows(ctx, args.absorbedId, args.survivorId);
    if (moreLeft) {
      await ctx.scheduler.runAfter(
        0,
        internal.features.duplicates.internal.repointMergedLead,
        args,
      );
    }
    return { isDone: !moreLeft };
  },
});
