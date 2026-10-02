import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const HOUR = 60 * 60 * 1000;
beforeEach(() => {
  pinClock(NOW);
});

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, {
    email: 'admin@example.com',
    role: 'admin',
    firstName: 'Ada',
    lastName: 'Admin',
  });
  const nina = await seedEmployee(t, {
    email: 'nina@example.com',
    role: 'member',
    firstName: 'Nina',
    lastName: 'Membre',
  });
  await seedConfig(t);
  return {
    t,
    admin,
    nina,
    as: asIdentity(t, admin.identity),
    asNina: asIdentity(t, nina.identity),
  };
}

type As = ReturnType<typeof asIdentity>;

const history = (as: As, leadId: Id<'leads'>) =>
  as.query(api.features.leads.queries.listLifecycleHistory, { leadId });

const storedRows = (t: T, leadId: Id<'leads'>) =>
  t.run((ctx) =>
    ctx.db
      .query('lifecycleStageHistory')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .collect(),
  );

const record = (t: T, row: Omit<Doc<'lifecycleStageHistory'>, '_id' | '_creationTime'>) =>
  t.run((ctx) => ctx.db.insert('lifecycleStageHistory', row));

const workflow = (as: As, name: string) =>
  as.mutation(api.features.workflows.mutations.createWorkflow, {
    name,
    trigger: { type: 'consent_updated' },
    allowReEnrollment: true,
    nodes: [{ id: 'n1', type: 'set_lifecycle_stage', stage: 'sql' }],
    startNodeId: 'n1',
  });

describe('the lifecycle history of a contact', () => {
  test('is empty for a contact no stage change was logged for', async () => {
    const { t, as } = await setup();
    const leadId = await seedLead(t, { email: 'silent@example.com' });
    expect(await history(as, leadId)).toEqual([]);
  });

  test('starts with the first stage, from nothing, by its author', async () => {
    const { t, as } = await setup();
    const leadId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Léa',
      lastName: 'Martin',
      email: 'lea@example.com',
    });
    const [first] = await storedRows(t, leadId);
    expect(await history(as, leadId)).toEqual([
      {
        _id: first._id,
        from: null,
        to: 'lead',
        source: 'manual',
        changedAt: first._creationTime,
        changedByName: 'Ada Admin',
        workflowId: null,
        workflowName: null,
      },
    ]);
    expect(Math.floor(first._creationTime)).toBe(NOW);
  });

  test('lists the changes oldest first, a manual one by its author and a workflow one by its workflow', async () => {
    const { t, as } = await setup();
    const leadId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Léa',
      lastName: 'Martin',
      email: 'lea@example.com',
    });
    jest.setSystemTime(new Date(NOW + HOUR / 2));
    await as.mutation(api.features.leads.mutations.updateLead, { leadId, lifecycleStage: 'mql' });
    const workflowId = await workflow(as, 'Qualifier');
    jest.setSystemTime(new Date(NOW + HOUR / 2 + 1_000));
    await record(t, { leadId, from: 'mql', to: 'sql', source: 'workflow', workflowId });

    const rows = await history(as, leadId);
    expect(rows.map(({ _id, changedAt, ...row }) => row)).toEqual([
      {
        from: null,
        to: 'lead',
        source: 'manual',
        changedByName: 'Ada Admin',
        workflowId: null,
        workflowName: null,
      },
      {
        from: 'lead',
        to: 'mql',
        source: 'manual',
        changedByName: 'Ada Admin',
        workflowId: null,
        workflowName: null,
      },
      {
        from: 'mql',
        to: 'sql',
        source: 'workflow',
        changedByName: null,
        workflowId,
        workflowName: 'Qualifier',
      },
    ]);
    const stored = await storedRows(t, leadId);
    expect(rows.map((row) => [row._id, row.changedAt])).toEqual(
      stored.map((row) => [row._id, row._creationTime]),
    );
    expect(rows.map((row) => Math.floor(row.changedAt))).toEqual([
      NOW,
      NOW + HOUR / 2,
      NOW + HOUR / 2 + 1_000,
    ]);
  });

  test('keeps a change whose author or workflow is gone, without a name', async () => {
    const { t, as, nina } = await setup();
    const leadId = await seedLead(t, { email: 'lea@example.com' });
    const workflowId = await workflow(as, 'Ancien scénario');
    await record(t, { leadId, to: 'lead', source: 'import', changedBy: nina.userId });
    await record(t, { leadId, from: 'lead', to: 'sql', source: 'workflow', workflowId });
    await t.run(async (ctx) => {
      await ctx.db.delete(nina.userId);
      await ctx.db.delete(workflowId);
    });

    const rows = await history(as, leadId);
    expect(rows.map(({ _id, changedAt, ...row }) => row)).toEqual([
      {
        from: null,
        to: 'lead',
        source: 'import',
        changedByName: null,
        workflowId: null,
        workflowName: null,
      },
      {
        from: 'lead',
        to: 'sql',
        source: 'workflow',
        changedByName: null,
        workflowId,
        workflowName: null,
      },
    ]);
  });

  test('carries every origin a change can have', async () => {
    const { t, as, admin } = await setup();
    const leadId = await seedLead(t, { email: 'lea@example.com' });
    const workflowId = await workflow(as, 'Qualifier');
    const steps = [
      { to: 'subscriber', source: 'migration' },
      { to: 'lead', source: 'form' },
      { to: 'mql', source: 'score' },
      { to: 'sql', source: 'api' },
      { to: 'opportunity', source: 'import', changedBy: admin.userId },
      { to: 'customer', source: 'deal', changedBy: admin.userId },
      { to: 'evangelist', source: 'workflow', workflowId },
      { to: 'other', source: 'manual', changedBy: admin.userId },
    ] as const;
    let from: string | undefined;
    for (const step of steps) {
      await record(t, { leadId, ...(from !== undefined && { from }), ...step });
      from = step.to;
    }

    const rows = await history(as, leadId);
    expect(rows.map((row) => [row.from, row.to, row.source, row.changedByName])).toEqual([
      [null, 'subscriber', 'migration', null],
      ['subscriber', 'lead', 'form', null],
      ['lead', 'mql', 'score', null],
      ['mql', 'sql', 'api', null],
      ['sql', 'opportunity', 'import', 'Ada Admin'],
      ['opportunity', 'customer', 'deal', 'Ada Admin'],
      ['customer', 'evangelist', 'workflow', null],
      ['evangelist', 'other', 'manual', 'Ada Admin'],
    ]);
    expect(rows.map((row) => row.workflowName).filter(Boolean)).toEqual(['Qualifier']);
  });

  test('shows a member the history of their own contacts only', async () => {
    const { as, asNina, admin, nina } = await setup();
    const own = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Léa',
      lastName: 'Martin',
      email: 'lea@example.com',
      ownerIds: [nina.userId],
    });
    const foreign = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Paul',
      lastName: 'Durand',
      email: 'paul@example.com',
      ownerIds: [admin.userId],
    });

    expect(await history(asNina, own)).toMatchObject([
      { from: null, to: 'lead', source: 'manual', changedByName: 'Ada Admin' },
    ]);
    expect(await history(asNina, foreign)).toEqual([]);
    expect(await history(as, foreign)).toHaveLength(1);
  });

  test('names a workflow only to who sees it', async () => {
    const { t, as, asNina, nina } = await setup();
    const leadId = await seedLead(t, { email: 'lea@example.com', ownerIds: [nina.userId] });
    const workflowId = await workflow(as, 'Qualifier');
    await record(t, { leadId, to: 'sql', source: 'workflow', workflowId });

    expect(await history(as, leadId)).toMatchObject([{ workflowId, workflowName: 'Qualifier' }]);
    // The admin's workflow is outside a member's perimeter.
    expect(await history(asNina, leadId)).toMatchObject([{ workflowId, workflowName: null }]);
  });
});
