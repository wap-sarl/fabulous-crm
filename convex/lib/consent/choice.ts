import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type {
  ConsentSource,
  LeadSubscription,
  MarketingConsentChannel,
  SubscriptionStatus,
} from '../../_lib/validators/crm';
import { isSubscribed } from '../../_lib/validators/subscriptions';
import { computeChanges, logAudit } from '../audit/log';
import { dispatchWorkflowTrigger } from '../workflows/dispatch';
import { loadActiveSubscriptionTypes } from './types';

/** What a person decided, in one of three shapes: the channels they keep, a choice per type, or nothing at all. */
export type ConsentChoice = {
  channels?: MarketingConsentChannel[];
  types?: { typeId: Id<'subscriptionTypes'>; status: SubscriptionStatus }[];
  unsubscribeAll?: boolean;
};

export type ConsentOrigin = { source: ConsentSource; ipHash?: string; at?: number };

type Standing = Pick<Doc<'leads'>, 'marketingConsent' | 'subscriptions'>;
type Change = {
  typeId?: Id<'subscriptionTypes'>;
  channel?: MarketingConsentChannel;
  from: SubscriptionStatus;
  to: SubscriptionStatus;
};

const status = (on: boolean): SubscriptionStatus => (on ? 'in' : 'out');

/** What changed between two standings: each channel joined or left, each active type the person is now in or out on. */
function diffConsent(
  before: Standing,
  after: Standing,
  types: Doc<'subscriptionTypes'>[],
): Change[] {
  const changes: Change[] = [];
  const channels = new Set([...before.marketingConsent, ...after.marketingConsent]);
  for (const channel of channels) {
    const from = status(before.marketingConsent.includes(channel));
    const to = status(after.marketingConsent.includes(channel));
    if (from !== to) changes.push({ channel, from, to });
  }
  for (const type of types) {
    const from = status(isSubscribed(before, type));
    const to = status(isSubscribed(after, type));
    if (from !== to) changes.push({ typeId: type._id, from, to });
  }
  return changes;
}

/** The standing a choice leaves: a channel refused takes each of its types with it, a type joined brings its channel along, a type refused stands alone. */
function standingAfter(
  lead: Standing,
  choice: ConsentChoice,
  types: Doc<'subscriptionTypes'>[],
  origin: ConsentOrigin,
  at: number,
): Standing {
  const entries = new Map<Id<'subscriptionTypes'>, LeadSubscription>(
    (lead.subscriptions ?? []).map((s) => [s.typeId, s]),
  );
  const set = (typeId: Id<'subscriptionTypes'>, next: SubscriptionStatus) =>
    entries.set(typeId, { typeId, status: next, source: origin.source, at });
  let channels = [...lead.marketingConsent];

  if (choice.unsubscribeAll) {
    channels = [];
    for (const entry of entries.values()) set(entry.typeId, 'out');
    for (const type of types) set(type._id, 'out');
  }
  if (choice.channels) {
    const kept = new Set(choice.channels);
    for (const type of types) {
      if (channels.includes(type.channel) && !kept.has(type.channel)) set(type._id, 'out');
    }
    channels = [...kept];
  }
  for (const { typeId, status: next } of choice.types ?? []) {
    const type = types.find((t) => t._id === typeId);
    if (!type) continue;
    set(typeId, next);
    if (next === 'in' && !channels.includes(type.channel)) channels.push(type.channel);
  }
  return { marketingConsent: channels, subscriptions: [...entries.values()] };
}

/** A person's choice applied to their record: the lead patched, one event per change kept for good, the audit entry and the workflows told; nothing written when nothing changed. */
export async function applyConsentChoice(
  ctx: MutationCtx,
  lead: Doc<'leads'>,
  choice: ConsentChoice,
  origin: ConsentOrigin,
): Promise<{ changed: boolean }> {
  const at = origin.at ?? Date.now();
  const types = await loadActiveSubscriptionTypes(ctx);
  const after = standingAfter(lead, choice, types, origin, at);
  const changes = diffConsent(lead, after, types);
  const entriesChanged =
    JSON.stringify(lead.subscriptions ?? []) !== JSON.stringify(after.subscriptions);
  if (changes.length === 0 && !entriesChanged) return { changed: false };

  await ctx.db.patch(lead._id, {
    marketingConsent: after.marketingConsent,
    subscriptions: after.subscriptions,
    consentUpdatedAt: at,
    consentSource: origin.source,
    updatedAt: at,
  });
  if (changes.length === 0) return { changed: false };

  await recordConsentChanges(ctx, lead._id, changes, origin, at);
  // Re-submitting the same channels changes nothing worth reporting.
  const channelChanges = computeChanges(lead, { marketingConsent: after.marketingConsent });
  if (channelChanges) {
    await logAudit({
      ctx,
      entityType: 'lead',
      entityId: lead._id,
      action: 'update',
      metadata: { source: origin.source, changes: channelChanges },
    });
  }
  await dispatchWorkflowTrigger(ctx, lead._id, {
    type: 'consent_updated',
    typeIds: changes.flatMap((change) => (change.typeId ? [change.typeId] : [])),
  });
  return { changed: true };
}

/** Where a contact's last word on each channel stands, among their last events: withdrawn when that word is « out », a withdrawal later reversed is none. */
async function lastWordOnChannels(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
): Promise<Map<MarketingConsentChannel, SubscriptionStatus>> {
  const events = await ctx.db
    .query('consentEvents')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .order('desc')
    .take(WITHDRAWALS_LOOKBACK);
  const last = new Map<MarketingConsentChannel, SubscriptionStatus>();
  for (const event of events) {
    if (event.channel && !last.has(event.channel)) last.set(event.channel, event.to);
  }
  return last;
}

// A person changes their mind a few times, not hundreds: the withdrawals are among their last events.
const WITHDRAWALS_LOOKBACK = 200;

/** Whether a record withdrew a channel it lacks: its last word on it says so, or, for a withdrawal from before the events existed, its consent changed after the other record's grant. */
function withdrew(
  record: Doc<'leads'>,
  lastWord: Map<MarketingConsentChannel, SubscriptionStatus>,
  other: Doc<'leads'>,
  channel: MarketingConsentChannel,
): boolean {
  if (record.marketingConsent.includes(channel)) return false;
  const word = lastWord.get(channel);
  if (word !== undefined) return word === 'out';
  return (record.consentUpdatedAt ?? 0) > (other.consentUpdatedAt ?? 0);
}

/** What one record keeps of the other's consent when two records of one person become one: a channel either holds unless the other withdrew it, the newer choice per type, and the changes as events the merge signs. Returns the fields to patch on the survivor, none when nothing changes. */
export async function mergeConsent(
  ctx: MutationCtx,
  survivor: Doc<'leads'>,
  absorbed: Doc<'leads'>,
): Promise<Partial<
  Pick<Doc<'leads'>, 'marketingConsent' | 'subscriptions' | 'consentUpdatedAt' | 'consentSource'>
> | null> {
  const [mine, theirs] = await Promise.all([
    lastWordOnChannels(ctx, survivor._id),
    lastWordOnChannels(ctx, absorbed._id),
  ]);
  const marketingConsent = [
    ...new Set([...survivor.marketingConsent, ...absorbed.marketingConsent]),
  ].filter(
    (channel) =>
      !withdrew(survivor, mine, absorbed, channel) &&
      !withdrew(absorbed, theirs, survivor, channel),
  );
  const entries = new Map((survivor.subscriptions ?? []).map((s) => [s.typeId, s]));
  for (const theirs of absorbed.subscriptions ?? []) {
    const mine = entries.get(theirs.typeId);
    if (!mine || theirs.at > mine.at) entries.set(theirs.typeId, theirs);
  }
  const after = { marketingConsent, subscriptions: [...entries.values()] };
  const changes = diffConsent(survivor, after, await loadActiveSubscriptionTypes(ctx));
  const entriesChanged =
    JSON.stringify(survivor.subscriptions ?? []) !== JSON.stringify(after.subscriptions);
  if (changes.length === 0 && !entriesChanged) return null;
  const at = Date.now();
  await recordConsentChanges(ctx, survivor._id, changes, { source: 'merge' }, at);
  return {
    ...after,
    ...(changes.length > 0 && { consentUpdatedAt: at, consentSource: 'merge' as const }),
  };
}

/** The consent a contact was created with, as events: what their first record says against nothing. */
export async function recordInitialConsent(
  ctx: MutationCtx,
  lead: Doc<'leads'>,
  origin: ConsentOrigin,
): Promise<void> {
  const types = await loadActiveSubscriptionTypes(ctx);
  const changes = diffConsent({ marketingConsent: [], subscriptions: [] }, lead, types);
  await recordConsentChanges(ctx, lead._id, changes, origin, origin.at ?? lead._creationTime);
}

async function recordConsentChanges(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  changes: Change[],
  origin: ConsentOrigin,
  at: number,
): Promise<void> {
  for (const change of changes) {
    await ctx.db.insert('consentEvents', {
      leadId,
      at,
      ...change,
      source: origin.source,
      ipHash: origin.ipHash,
    });
  }
}
