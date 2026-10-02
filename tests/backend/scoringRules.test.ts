import { describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { LeadAdvancedFilter } from '../../convex/_lib/validators/filters';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
// Less than the session of the employees lasts.
const LATER = NOW + 10 * 60 * 1000;
const write = api.features.scoring.mutations;
const read = api.features.scoring.queries;

type As = ReturnType<typeof asIdentity>;

async function setup() {
  const t = createTestConvex();
  pinClock(NOW);
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t);
  return {
    t,
    userId: admin.userId,
    as: asIdentity(t, admin.identity),
    asMember: asIdentity(t, member.identity),
  };
}

const oneRule = (
  rule: LeadAdvancedFilter['groups'][number]['rules'][number],
): LeadAdvancedFilter => ({
  combinator: 'and',
  groups: [{ combinator: 'and', rules: [rule] }],
});
const noOwner = () =>
  oneRule({ field: { kind: 'standard', field: 'ownerIds' }, operator: 'isEmpty' });
const emailContains = (needle: string) =>
  oneRule({ field: { kind: 'standard', field: 'email' }, operator: 'contains', value: needle });

function createRule(
  as: As,
  name: string,
  criteria: LeadAdvancedFilter,
  points: number,
  extra: { description?: string; decayHalfLifeDays?: number; active?: boolean } = {},
) {
  return as.mutation(write.createScoringRule, {
    name,
    criteria,
    points,
    active: extra.active ?? true,
    description: extra.description,
    decayHalfLifeDays: extra.decayHalfLifeDays,
  });
}

const createLead = (as: As, email = 'ada@example.com') =>
  as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email,
  });

const scoreOf = (t: T, leadId: Id<'leads'>) =>
  t.run(async (ctx) => {
    const lead = await ctx.db.get(leadId);
    return { score: lead?.leadScore, breakdown: lead?.scoreBreakdown };
  });

/** Runs the recomputation to its end; a timer that fires moves the date to the real one, so it is put back. */
async function settle(t: T, backTo = NOW) {
  await runDue(t);
  jest.setSystemTime(new Date(backTo));
}

const stateRow = (t: T) => t.run((ctx) => ctx.db.query('scoringState').first());

/** The scoring jobs, with their state. */
const scoringJobs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .map((job) => ({
        name: job.name.split(/[:/.]/).at(-1),
        state: job.state.kind,
        at: job.scheduledTime,
      }))
      .filter((job) => ['recomputeScoresPage', 'startScheduledScoreRecompute'].includes(job.name!)),
  );
const pendingJobs = async (t: T) =>
  (await scoringJobs(t))
    .filter((job) => job.state === 'pending')
    .map(({ name, at }) => ({ name, at }));

const auditsOf = (t: T, entityId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect())
      .filter((a) => a.entityId === entityId)
      .map((a) => ({ entityType: a.entityType, action: a.action, userId: a.userId })),
  );

const orderOf = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query('scoringRules').collect())
      .sort((a, b) => a.order - b.order)
      .map((r) => ({ name: r.name, order: r.order })),
  );

describe('the scoring rules as the settings page reads them', () => {
  test('no rule gives an empty list', async () => {
    const { as } = await setup();
    expect(await as.query(read.listScoringRules, {})).toEqual([]);
  });

  test('the rules come in their order, with a description and a decay only when they have one', async () => {
    const { as, asMember } = await setup();
    const full = await createRule(as, 'Adresse pro', emailContains('example.com'), 30, {
      description: 'Une adresse de la société',
      decayHalfLifeDays: 14,
    });
    const bare = await createRule(as, 'Sans propriétaire', noOwner(), -20, { active: false });

    const rules = await as.query(read.listScoringRules, {});
    expect(rules).toEqual([
      {
        _id: full,
        name: 'Adresse pro',
        description: 'Une adresse de la société',
        criteria: emailContains('example.com'),
        points: 30,
        active: true,
        decayHalfLifeDays: 14,
      },
      {
        _id: bare,
        name: 'Sans propriétaire',
        description: undefined,
        criteria: noOwner(),
        points: -20,
        active: false,
        decayHalfLifeDays: undefined,
      },
    ]);
    // What a rule does not have comes as no field at all.
    expect(Object.keys(rules[1]).sort()).toEqual(['_id', 'active', 'criteria', 'name', 'points']);
    // The breakdown card of a contact reads them too: no settings access is asked.
    expect(await asMember.query(read.listScoringRules, {})).toEqual(rules);
  });
});

describe('reordering the scoring rules', () => {
  test('the rules take the order given', async () => {
    const { t, as } = await setup();
    const a = await createRule(as, 'A', noOwner(), 10);
    const b = await createRule(as, 'B', noOwner(), 20);
    const c = await createRule(as, 'C', noOwner(), 30);

    expect(await as.mutation(write.reorderScoringRules, { ruleIds: [c, a, b] })).toBeNull();
    expect(await orderOf(t)).toEqual([
      { name: 'C', order: 0 },
      { name: 'A', order: 1 },
      { name: 'B', order: 2 },
    ]);
    const listed = await as.query(read.listScoringRules, {});
    expect(listed.map((r) => r._id)).toEqual([c, a, b]);
  });

  test('with no rule the empty order is accepted', async () => {
    const { as } = await setup();
    expect(await as.mutation(write.reorderScoringRules, { ruleIds: [] })).toBeNull();
  });

  test('an order with an unknown rule, the same rule twice or a rule missing is refused, and nothing moves', async () => {
    const { t, as } = await setup();
    const a = await createRule(as, 'A', noOwner(), 10);
    const b = await createRule(as, 'B', noOwner(), 20);
    const gone = await createRule(as, 'Supprimée', noOwner(), 30);
    await as.mutation(write.deleteScoringRule, { ruleId: gone });

    for (const ruleIds of [[b, a, gone], [b, b], [b], []]) {
      await expect(as.mutation(write.reorderScoringRules, { ruleIds })).rejects.toMatchObject({
        data: { code: 'invalid_scoring_order' },
      });
    }
    expect(await orderOf(t)).toEqual([
      { name: 'A', order: 0 },
      { name: 'B', order: 1 },
    ]);
  });
});

describe('deleting a scoring rule', () => {
  test('the rule goes, the deletion is logged and every score is recomputed without it', async () => {
    const { t, as, userId } = await setup();
    const kept = await createRule(as, 'Adresse pro', emailContains('example.com'), 30);
    const dropped = await createRule(as, 'Sans propriétaire', noOwner(), 20);
    await settle(t);
    const leadId = await createLead(as);
    expect(await scoreOf(t, leadId)).toEqual({
      score: 50,
      breakdown: { [kept]: 30, [dropped]: 20 },
    });

    expect(await as.mutation(write.deleteScoringRule, { ruleId: dropped })).toBeNull();

    expect(await t.run((ctx) => ctx.db.get(dropped))).toBeNull();
    expect((await auditsOf(t, dropped)).filter((a) => a.action === 'delete')).toEqual([
      { entityType: 'scoringRule', action: 'delete', userId },
    ]);
    expect((await stateRow(t))?.recalc).toEqual({ stamp: NOW, processed: 0 });
    expect(await pendingJobs(t)).toEqual([{ name: 'recomputeScoresPage', at: NOW }]);
    // No contact was written: the stored score waits for the recomputation.
    expect((await scoreOf(t, leadId)).score).toBe(50);

    await settle(t);
    expect(await scoreOf(t, leadId)).toEqual({ score: 30, breakdown: { [kept]: 30 } });
    expect((await stateRow(t))?.recalc).toBeUndefined();
    expect(await as.query(read.listScoringRules, {})).toMatchObject([{ _id: kept }]);
  });

  test('a rule already gone changes nothing: no log, no recomputation', async () => {
    const { t, as } = await setup();
    const ruleId = await createRule(as, 'Sans propriétaire', noOwner(), 20);
    await as.mutation(write.deleteScoringRule, { ruleId });
    await settle(t);
    const audits = await auditsOf(t, ruleId);
    const jobs = await scoringJobs(t);
    const state = await stateRow(t);
    expect(state?.recalc).toBeUndefined();

    pinClock(LATER);
    expect(await as.mutation(write.deleteScoringRule, { ruleId })).toBeNull();

    expect(await auditsOf(t, ruleId)).toEqual(audits);
    expect(await scoringJobs(t)).toEqual(jobs);
    expect(await stateRow(t)).toEqual(state);
  });
});

describe('recomputing the scores by hand', () => {
  test('every contact is scored again with the rules as they are, and the run leaves its date', async () => {
    const { t, as } = await setup();
    const ruleId = await createRule(as, 'Adresse pro', emailContains('example.com'), 30);
    await settle(t);
    const leadId = await createLead(as);
    const other = await createLead(as, 'bob@elsewhere.example.org');
    // A rule changed behind the mutations leaves the stored scores stale; the date of the last run is set to tell the next one from it.
    await t.run(async (ctx) => {
      await ctx.db.patch(ruleId, { points: 45 });
      const state = await ctx.db.query('scoringState').first();
      if (state) await ctx.db.patch(state._id, { lastRecalcAt: NOW - DAY_MS });
    });
    expect((await scoreOf(t, leadId)).score).toBe(30);

    pinClock(LATER);
    expect(await as.mutation(write.recomputeScores, {})).toBeNull();

    expect(await as.query(read.getScoringState, {})).toEqual({
      recalcProcessed: 0,
      lastRecalcAt: NOW - DAY_MS,
      nightlyScheduled: false,
      simulation: null,
    });
    expect((await stateRow(t))?.recalc).toEqual({ stamp: LATER, processed: 0 });
    expect(await pendingJobs(t)).toEqual([{ name: 'recomputeScoresPage', at: LATER }]);

    await settle(t, LATER);
    expect(await scoreOf(t, leadId)).toEqual({ score: 45, breakdown: { [ruleId]: 45 } });
    expect(await scoreOf(t, other)).toEqual({ score: undefined, breakdown: undefined });
    const state = await as.query(read.getScoringState, {});
    expect(state).toEqual({
      recalcProcessed: null,
      lastRecalcAt: expect.any(Number),
      nightlyScheduled: false,
      simulation: null,
    });
    expect(state.lastRecalcAt).toBeGreaterThan(NOW - DAY_MS);
    expect(await pendingJobs(t)).toEqual([]);
  });

  test('the nightly recomputation that was booked is cancelled, then booked again by the new run', async () => {
    const { t, as } = await setup();
    await createRule(as, 'Adresse pro', emailContains('example.com'), 30, {
      decayHalfLifeDays: 7,
    });
    await settle(t);
    const nightly = { name: 'startScheduledScoreRecompute', at: expect.any(Number) };
    expect(await pendingJobs(t)).toEqual([nightly]);
    expect((await as.query(read.getScoringState, {})).nightlyScheduled).toBe(true);

    pinClock(LATER);
    expect(await as.mutation(write.recomputeScores, {})).toBeNull();

    expect(await scoringJobs(t)).toEqual([
      { name: 'recomputeScoresPage', state: 'success', at: NOW },
      { ...nightly, state: 'canceled' },
      { name: 'recomputeScoresPage', state: 'pending', at: LATER },
    ]);
    expect(await as.query(read.getScoringState, {})).toMatchObject({
      recalcProcessed: 0,
      nightlyScheduled: false,
    });

    await settle(t, LATER);
    expect(await pendingJobs(t)).toEqual([nightly]);
    expect(await as.query(read.getScoringState, {})).toEqual({
      recalcProcessed: null,
      lastRecalcAt: expect.any(Number),
      nightlyScheduled: true,
      simulation: null,
    });
  });

  test('an employee without the settings can neither delete, reorder nor recompute', async () => {
    const { t, as, asMember } = await setup();
    const ruleId = await createRule(as, 'Sans propriétaire', noOwner(), 20);
    await settle(t);
    const jobs = await scoringJobs(t);

    await expect(asMember.mutation(write.deleteScoringRule, { ruleId })).rejects.toThrow(
      'Unauthorized: settings access',
    );
    await expect(
      asMember.mutation(write.reorderScoringRules, { ruleIds: [ruleId] }),
    ).rejects.toThrow('Unauthorized: settings access');
    await expect(asMember.mutation(write.recomputeScores, {})).rejects.toThrow(
      'Unauthorized: settings access',
    );

    expect(await t.run((ctx) => ctx.db.get(ruleId))).not.toBeNull();
    expect(await scoringJobs(t)).toEqual(jobs);
  });
});

describe('the state of the scoring', () => {
  test('before anything ran, nothing is known', async () => {
    const { as } = await setup();
    expect(await as.query(read.getScoringState, {})).toEqual({
      recalcProcessed: null,
      lastRecalcAt: null,
      nightlyScheduled: false,
      simulation: null,
    });
  });

  test('a recomputation in progress says how many contacts it has done', async () => {
    const { t, as, asMember } = await setup();
    await t.run((ctx) =>
      ctx.db.insert('scoringState', {
        recalc: { stamp: NOW, processed: 200 },
        lastRecalcAt: NOW - DAY_MS,
      }),
    );
    const state = await as.query(read.getScoringState, {});
    expect(state).toEqual({
      recalcProcessed: 200,
      lastRecalcAt: NOW - DAY_MS,
      nightlyScheduled: false,
      simulation: null,
    });
    // The progress is not behind the settings access.
    expect(await asMember.query(read.getScoringState, {})).toEqual(state);
  });

  test('a simulation shows where it started, then its result', async () => {
    const { t, as } = await setup();
    await createRule(as, 'Adresse pro', emailContains('example.com'), 60);
    await settle(t);
    await createLead(as);
    await createLead(as, 'bob@elsewhere.example.org');

    await as.mutation(write.startScoreSimulation, { threshold: 50 });
    expect((await as.query(read.getScoringState, {})).simulation).toEqual({
      threshold: 50,
      stamp: NOW,
      processed: 0,
      matched: 0,
    });

    await settle(t);
    expect(await as.query(read.getScoringState, {})).toEqual({
      recalcProcessed: null,
      lastRecalcAt: expect.any(Number),
      nightlyScheduled: false,
      simulation: {
        threshold: 50,
        stamp: NOW,
        processed: 2,
        matched: 1,
        finishedAt: expect.any(Number),
      },
    });
  });
});
