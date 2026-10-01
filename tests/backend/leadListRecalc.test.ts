import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { LeadAdvancedFilter } from '../../convex/_lib/validators/filters';
import { DEFAULT_MAX_DYNAMIC_LISTS } from '../../convex/_lib/validators/leadLists';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const MINUTE = 60 * 1000;
beforeEach(() => {
  pinClock(NOW);
});

async function setup(config: { maxDynamicLists?: number } | null = {}) {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  if (config) {
    await seedConfig(
      t,
      config.maxDynamicLists !== undefined
        ? { lists: { maxDynamicLists: config.maxDynamicLists } }
        : {},
    );
  }
  return {
    t,
    as: asIdentity(t, admin.identity),
    asMember: asIdentity(t, member.identity),
  };
}

type As = ReturnType<typeof asIdentity>;

/** Runs the pages of a recalculation to their end; running timers moves the date, so it goes back for the seeded sessions. */
async function settle(t: T, backTo = NOW) {
  await runDue(t);
  jest.setSystemTime(new Date(backTo));
}

const MQL: LeadAdvancedFilter = {
  combinator: 'and',
  groups: [
    {
      combinator: 'and',
      rules: [
        {
          field: { kind: 'standard', field: 'lifecycleStage' },
          operator: 'equals',
          value: ['mql'],
        },
      ],
    },
  ],
};

/** A criterion that drifts with time: its list books a recalculation a day ahead. */
const OPENED_RECENTLY: LeadAdvancedFilter = {
  combinator: 'and',
  groups: [
    {
      combinator: 'and',
      rules: [
        {
          field: { kind: 'standard', field: 'lastEmailOpenAt' },
          operator: 'inLastDays',
          value: 30,
        },
      ],
    },
  ],
};

/** A dynamic list whose first recalculation has run to its end. */
async function dynamicList(t: T, as: As, name: string, criteria: LeadAdvancedFilter) {
  const listId = await as.mutation(api.features.leadLists.mutations.createLeadList, {
    name,
    kind: 'dynamic',
    criteria,
  });
  await settle(t);
  return listId;
}

const listOf = (t: T, listId: Id<'leadLists'>) => t.run((ctx) => ctx.db.get(listId));

const memberIds = (t: T, listId: Id<'leadLists'>) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query('leadListMembers')
        .withIndex('by_list_lead', (q) => q.eq('listId', listId))
        .collect()
    ).map((row) => row.leadId),
  );

/** The scheduled jobs of the recalculation, whatever their state. */
const recalcJobs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.name.includes('leadLists/internal'))
      .map((job) => ({
        _id: job._id,
        name: job.name.split(':')[1],
        state: job.state.kind,
        args: job.args[0],
      })),
  );

describe('the dynamic-list cap and its usage', () => {
  test('a deployment without settings has the default cap and no list', async () => {
    const { as } = await setup(null);
    expect(await as.query(api.features.leadLists.queries.getListLimits, {})).toEqual({
      maxDynamicLists: DEFAULT_MAX_DYNAMIC_LISTS,
      dynamicCount: 0,
    });
  });

  test('settings without a cap of their own keep the default', async () => {
    const { as } = await setup();
    expect(await as.query(api.features.leadLists.queries.getListLimits, {})).toEqual({
      maxDynamicLists: 20,
      dynamicCount: 0,
    });
  });

  test('the configured cap comes with the count of dynamic lists, static ones apart', async () => {
    const { t, as } = await setup({ maxDynamicLists: 3 });
    await dynamicList(t, as, 'MQL', MQL);
    await dynamicList(t, as, 'Ouvreurs 30 j', OPENED_RECENTLY);
    await as.mutation(api.features.leadLists.mutations.createLeadList, { name: 'Salon 2026' });

    expect(await as.query(api.features.leadLists.queries.getListLimits, {})).toEqual({
      maxDynamicLists: 3,
      dynamicCount: 2,
    });
  });
});

describe('recalculating a dynamic list on demand', () => {
  test('answers null and books a full run, which puts the members right', async () => {
    const { t, as } = await setup();
    const listId = await dynamicList(t, as, 'MQL', MQL);
    const stays = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Reste',
      lifecycleStage: 'mql',
    });
    const leaves = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'Sort',
      lifecycleStage: 'mql',
    });
    // Written behind the triggers' back: the memberships no longer say what the criteria say.
    await t.run((ctx) => ctx.db.patch(leaves, { lifecycleStage: 'sql' }));
    const joins = await seedLead(t, { lastName: 'Entre', lifecycleStage: 'mql' });
    expect((await memberIds(t, listId)).sort()).toEqual([stays, leaves].sort());
    jest.setSystemTime(new Date(NOW + 5 * MINUTE));

    expect(
      await as.mutation(api.features.leadLists.mutations.recalcLeadList, { listId }),
    ).toBeNull();

    expect((await listOf(t, listId))?.recalc).toEqual({ stamp: NOW + 5 * MINUTE, processed: 0 });
    expect((await recalcJobs(t)).filter((job) => job.state === 'pending')).toMatchObject([
      { name: 'recalcDynamicListPage', args: { listId, stamp: NOW + 5 * MINUTE } },
    ]);
    const running = await as.query(api.features.leadLists.queries.listLeadLists, {});
    expect(running).toMatchObject([{ _id: listId, recalcProcessed: 0, memberCount: 2 }]);

    await settle(t);
    expect((await memberIds(t, listId)).sort()).toEqual([stays, joins].sort());
    const settled = await listOf(t, listId);
    expect(settled?.recalc).toBeUndefined();
    expect(settled?.nextRecalcId).toBeUndefined();
    expect((await recalcJobs(t)).map((job) => job.state)).toEqual(['success', 'success']);
    const listed = await as.query(api.features.leadLists.queries.listLeadLists, {});
    expect(listed).toMatchObject([{ _id: listId, recalcProcessed: null, memberCount: 2 }]);
  });

  test('replaces the time-drift run a list had booked', async () => {
    const { t, as } = await setup();
    const listId = await dynamicList(t, as, 'Ouvreurs 30 j', OPENED_RECENTLY);
    const driftId = (await listOf(t, listId))?.nextRecalcId;
    expect(driftId).toBeDefined();
    jest.setSystemTime(new Date(NOW + MINUTE));

    expect(
      await as.mutation(api.features.leadLists.mutations.recalcLeadList, { listId }),
    ).toBeNull();

    const restarted = await listOf(t, listId);
    expect(restarted?.nextRecalcId).toBeUndefined();
    expect(restarted?.recalc).toEqual({ stamp: NOW + MINUTE, processed: 0 });
    const jobs = await recalcJobs(t);
    expect(jobs.find((job) => job._id === driftId)?.state).toBe('canceled');
    expect(jobs.filter((job) => job.state === 'pending').map((job) => job.name)).toEqual([
      'recalcDynamicListPage',
    ]);

    await settle(t);
    const settled = await listOf(t, listId);
    expect(settled?.recalc).toBeUndefined();
    expect(settled?.nextRecalcId).toBeDefined();
    expect(settled?.nextRecalcId).not.toBe(driftId);
  });

  test('a second request makes the pages of the first one no-ops', async () => {
    const { t, as } = await setup();
    const listId = await dynamicList(t, as, 'MQL', MQL);
    await as.mutation(api.features.leadLists.mutations.recalcLeadList, { listId });
    jest.setSystemTime(new Date(NOW + MINUTE));
    await as.mutation(api.features.leadLists.mutations.recalcLeadList, { listId });

    expect((await listOf(t, listId))?.recalc).toEqual({ stamp: NOW + MINUTE, processed: 0 });
    const pending = (await recalcJobs(t)).filter((job) => job.state === 'pending');
    expect(pending.map((job) => (job.args as { stamp: number }).stamp)).toEqual([
      NOW,
      NOW + MINUTE,
    ]);
    await settle(t);
    expect((await listOf(t, listId))?.recalc).toBeUndefined();
  });

  test('is refused for a static list', async () => {
    const { t, as } = await setup();
    const listId = await as.mutation(api.features.leadLists.mutations.createLeadList, {
      name: 'Salon 2026',
    });
    await expect(
      as.mutation(api.features.leadLists.mutations.recalcLeadList, { listId }),
    ).rejects.toMatchObject({ data: { code: 'list_not_dynamic' } });
    expect((await listOf(t, listId))?.recalc).toBeUndefined();
    expect(await recalcJobs(t)).toEqual([]);
  });

  test('is refused for a list that is gone', async () => {
    const { t, as } = await setup();
    const listId = await dynamicList(t, as, 'MQL', MQL);
    await as.mutation(api.features.leadLists.mutations.deleteLeadList, {
      listId,
      deleteLeads: false,
    });
    await expect(
      as.mutation(api.features.leadLists.mutations.recalcLeadList, { listId }),
    ).rejects.toMatchObject({ data: { code: 'list_not_found' } });
    expect((await recalcJobs(t)).filter((job) => job.state === 'pending')).toEqual([]);
  });

  test('is refused for a list the caller does not see', async () => {
    const { t, as, asMember } = await setup();
    const listId = await dynamicList(t, as, 'MQL', MQL);
    await expect(
      asMember.mutation(api.features.leadLists.mutations.recalcLeadList, { listId }),
    ).rejects.toMatchObject({ data: { code: 'list_not_found' } });
    expect((await listOf(t, listId))?.recalc).toBeUndefined();
  });
});
