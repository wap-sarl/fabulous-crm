import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import type { DuplicateReason } from '../../_lib/validators/duplicates';
import { isNotDeleted } from '../../lib';
import {
  compareIdentities,
  findDuplicateCandidates,
  identityOf,
  nameBlock,
  nameKey,
  phoneKey,
  postalKey,
} from '../../lib/duplicates';

/** What the pairs list shows of each side. */
export type DuplicateLeadSummary = {
  _id: Id<'leads'>;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  createdAt: number;
};

const summarize = (lead: Doc<'leads'>): DuplicateLeadSummary => ({
  _id: lead._id,
  name: `${lead.firstName} ${lead.lastName}`,
  email: lead.email ?? null,
  phone: lead.phone ?? null,
  city: lead.address?.city ?? null,
  createdAt: lead._creationTime,
});

async function liveLead(ctx: QueryCtx, id: Id<'leads'>): Promise<Doc<'leads'> | null> {
  const lead = await ctx.db.get(id);
  return lead && isNotDeleted(lead) ? lead : null;
}

/** The latest scan (running or finished), for the page header. */
export const getLatestDuplicateScan = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const scan = await ctx.db.query('duplicateScans').order('desc').first();
    if (!scan) return null;
    const user = await ctx.db.get(scan.startedBy);
    return { ...scan, startedByName: user ? `${user.firstName} ${user.lastName}` : null };
  },
});

/** Open pairs, strongest first within the scan order; pairs of a deleted lead are hidden. */
export const listDuplicatePairs = employeeQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.union(v.literal('open'), v.literal('ignored'))),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query('leadDuplicates')
      .withIndex('by_status_score', (q) => q.eq('status', args.status ?? 'open'))
      .order('desc')
      .paginate(args.paginationOpts);
    const page = [];
    for (const pair of result.page) {
      const a = await liveLead(ctx, pair.leadAId);
      const b = await liveLead(ctx, pair.leadBId);
      if (!a || !b) continue;
      page.push({ ...pair, leadA: summarize(a), leadB: summarize(b) });
    }
    return { ...result, page };
  },
});

/** Open pairs count for the badge (capped: the page reads at most 101 rows). */
export const countOpenDuplicates = employeeQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('leadDuplicates')
      .withIndex('by_status_score', (q) => q.eq('status', 'open'))
      .take(101);
    return { count: Math.min(rows.length, 100), capped: rows.length > 100 };
  },
});

/** Both full leads of a pair, with the names the comparison table displays. */
export const getDuplicatePair = employeeQuery({
  args: { pairId: v.id('leadDuplicates') },
  handler: async (ctx, args) => {
    const pair = await ctx.db.get(args.pairId);
    if (!pair) return null;
    const a = await liveLead(ctx, pair.leadAId);
    const b = await liveLead(ctx, pair.leadBId);
    if (!a || !b) return null;
    const enrich = async (lead: Doc<'leads'>) => {
      const ownerNames: string[] = [];
      for (const id of lead.ownerIds) {
        const owner = await ctx.db.get(id);
        if (owner) ownerNames.push(`${owner.firstName} ${owner.lastName}`);
      }
      const company = lead.companyId ? await ctx.db.get(lead.companyId) : null;
      return {
        lead,
        ownerNames,
        companyName: company && isNotDeleted(company) ? company.name : null,
      };
    };
    return { pair, a: await enrich(a), b: await enrich(b) };
  },
});

export const findImportMatches = employeeQuery({
  args: {
    rows: v.array(
      v.object({
        firstName: v.string(),
        lastName: v.string(),
        email: v.optional(v.string()),
        phone: v.optional(v.string()),
        postalCode: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const matches: {
      index: number;
      leadId: Id<'leads'>;
      leadName: string;
      leadEmail: string | null;
      reasons: DuplicateReason[];
    }[] = [];
    for (let index = 0; index < args.rows.length; index++) {
      const row = args.rows[index];
      const identity = {
        phone: phoneKey(row.phone),
        name: nameKey(row.firstName, row.lastName),
        block: nameBlock(row.lastName),
        postal: postalKey(row.postalCode),
        email: row.email?.trim().toLowerCase() || undefined,
      };
      const candidates = await findDuplicateCandidates(ctx, identity);
      let best: (typeof matches)[number] | null = null;
      let bestScore = 0;
      for (const candidate of candidates) {
        const { reasons, score } = compareIdentities(identity, identityOf(candidate));
        // Same email → the import upserts it anyway; not a "potential" duplicate.
        if (reasons.includes('email')) {
          best = null;
          break;
        }
        if (score > bestScore) {
          bestScore = score;
          best = {
            index,
            leadId: candidate._id,
            leadName: `${candidate.firstName} ${candidate.lastName}`,
            leadEmail: candidate.email ?? null,
            reasons,
          };
        }
      }
      if (best) matches.push(best);
    }
    return matches;
  },
});
