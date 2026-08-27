import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { DuplicateReason, LeadDedupe } from '../_lib/validators/duplicates';
import { isNotDeleted } from './dbHelpers';
import { deleteListMember, insertListMember } from './leadListMembers';
import { normalizeSearchText } from './leadSearch';

const NAME_MAX_DISTANCE = 2;
const NAME_MIN_LENGTH = 6;
/** Candidates read per index per lead — bounds a scan step whatever the data. */
export const CANDIDATE_LIMIT = 100;

const REASON_WEIGHT: Record<DuplicateReason, number> = {
  email: 3,
  phone: 3,
  name_postal: 2,
  same_name: 1,
  similar_name: 1,
};

/** E.164 (`+33612345678`) via libphonenumber (FR default), else the bare digits when long enough. */
export function phoneKey(phone: string | undefined): string | undefined {
  if (!phone?.trim()) return undefined;
  const parsed = parsePhoneNumberFromString(phone, 'FR');
  if (parsed?.isValid()) return parsed.number;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 ? digits : undefined;
}

const squash = (s: string) => normalizeSearchText(s).replace(/\s+/g, '');

export function nameKey(firstName: string, lastName: string): string {
  return `${squash(lastName)}|${squash(firstName)}`;
}

export function postalKey(postalCode: string | undefined): string | undefined {
  const key = (postalCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return key || undefined;
}

/** Blocking key: the first three letters of the normalized last name. */
export function nameBlock(lastName: string): string | undefined {
  const last = squash(lastName);
  return last.length >= 2 ? last.slice(0, 3) : undefined;
}

/**
 * The keys a lead document should carry (stamped by the leads trigger). Unset
 * keys are omitted, not `undefined`: Convex rejects `undefined` inside nested
 * objects, and the trigger compares the object as stored.
 */
export function dedupeKeys(
  lead: Pick<Doc<'leads'>, 'firstName' | 'lastName' | 'phone' | 'address'>,
): LeadDedupe {
  const keys: LeadDedupe = { name: nameKey(lead.firstName, lead.lastName) };
  const phone = phoneKey(lead.phone);
  if (phone) keys.phone = phone;
  const block = nameBlock(lead.lastName);
  if (block) keys.block = block;
  const postal = postalKey(lead.address?.postalCode);
  if (postal) keys.postal = postal;
  return keys;
}

/** Levenshtein distance, giving up (returns max + 1) once `max` is exceeded. */
export function levenshtein(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export interface DedupeIdentity extends LeadDedupe {
  email?: string;
}

/** Why `a` and `b` may be the same person, and how strongly. Empty ⇒ unrelated. */
export function compareIdentities(
  a: DedupeIdentity,
  b: DedupeIdentity,
): { reasons: DuplicateReason[]; score: number } {
  const reasons: DuplicateReason[] = [];
  if (a.email && b.email && a.email === b.email) reasons.push('email');
  if (a.phone && b.phone && a.phone === b.phone) reasons.push('phone');
  if (a.name === b.name) {
    if (a.postal && b.postal && a.postal === b.postal) reasons.push('name_postal');
    else reasons.push('same_name');
  } else if (
    Math.min(a.name.length, b.name.length) >= NAME_MIN_LENGTH &&
    levenshtein(a.name, b.name, NAME_MAX_DISTANCE) <= NAME_MAX_DISTANCE
  ) {
    reasons.push('similar_name');
  }
  return { reasons, score: reasons.reduce((sum, r) => sum + REASON_WEIGHT[r], 0) };
}

export function identityOf(lead: Doc<'leads'>): DedupeIdentity {
  return { ...(lead.dedupe ?? dedupeKeys(lead)), email: lead.email };
}

export async function findDuplicateCandidates(
  ctx: QueryCtx | MutationCtx,
  identity: DedupeIdentity,
  excludeId?: Id<'leads'>,
): Promise<Doc<'leads'>[]> {
  const seen = new Set<string>();
  const out: Doc<'leads'>[] = [];
  const add = (rows: Doc<'leads'>[]) => {
    for (const row of rows) {
      if (row._id === excludeId || seen.has(row._id) || !isNotDeleted(row)) continue;
      seen.add(row._id);
      out.push(row);
    }
  };
  if (identity.email) {
    add(
      await ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', identity.email))
        .take(CANDIDATE_LIMIT),
    );
  }
  if (identity.phone) {
    add(
      await ctx.db
        .query('leads')
        .withIndex('by_dedupe_phone', (q) => q.eq('dedupe.phone', identity.phone))
        .take(CANDIDATE_LIMIT),
    );
  }
  if (identity.block) {
    add(
      await ctx.db
        .query('leads')
        .withIndex('by_dedupe_block', (q) => q.eq('dedupe.block', identity.block))
        .take(CANDIDATE_LIMIT),
    );
  }
  return out;
}

/** Rows re-pointed per table per call; a full batch reschedules itself. */
export const REPOINT_BATCH = 200;

/**
 * Move every row attached to `absorbedId` onto `survivorId`: notes,
 * activities, deals, workflow runs, status history, campaign sends (+ their
 * events and tracked-link tokens) and list memberships (deduplicated against
 * the survivor's own). Each table is read through its `by_lead` index; the
 * rows leave the index range as they are patched, so the loop needs no
 * cursor. Returns whether some table still holds rows (a full batch).
 */
export async function repointLeadRows(
  ctx: MutationCtx,
  absorbedId: Id<'leads'>,
  survivorId: Id<'leads'>,
): Promise<{ moreLeft: boolean }> {
  let moreLeft = false;
  const full = (n: number) => {
    if (n >= REPOINT_BATCH) moreLeft = true;
  };

  const notes = await ctx.db
    .query('leadNotes')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const row of notes) await ctx.db.patch(row._id, { leadId: survivorId });
  full(notes.length);

  const activities = await ctx.db
    .query('activities')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const row of activities) await ctx.db.patch(row._id, { leadId: survivorId });
  full(activities.length);

  const deals = await ctx.db
    .query('deals')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const row of deals) await ctx.db.patch(row._id, { leadId: survivorId });
  full(deals.length);

  const runs = await ctx.db
    .query('workflowRuns')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const row of runs) await ctx.db.patch(row._id, { leadId: survivorId });
  full(runs.length);

  const history = await ctx.db
    .query('lifecycleStageHistory')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const row of history) await ctx.db.patch(row._id, { leadId: survivorId });
  full(history.length);

  const sends = await ctx.db
    .query('campaignSends')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const send of sends) {
    await ctx.db.patch(send._id, { leadId: survivorId });
    const tokens = await ctx.db
      .query('campaignLinkTokens')
      .withIndex('by_send', (q) => q.eq('sendId', send._id))
      .collect();
    for (const token of tokens) await ctx.db.patch(token._id, { leadId: survivorId });
  }
  full(sends.length);

  const events = await ctx.db
    .query('campaignEvents')
    .withIndex('by_lead_eventAt', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const row of events) await ctx.db.patch(row._id, { leadId: survivorId });
  full(events.length);

  const memberships = await ctx.db
    .query('leadListMembers')
    .withIndex('by_lead', (q) => q.eq('leadId', absorbedId))
    .take(REPOINT_BATCH);
  for (const member of memberships) {
    const already = await ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', member.listId).eq('leadId', survivorId))
      .first();
    // Through the aggregate-aware helpers so list counts stay exact.
    await deleteListMember(ctx, member);
    if (!already) {
      await insertListMember(ctx, {
        listId: member.listId,
        leadId: survivorId,
        addedBy: member.addedBy,
      });
    }
  }
  full(memberships.length);

  return { moreLeft };
}
