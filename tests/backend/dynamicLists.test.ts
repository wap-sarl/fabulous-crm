import { describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { LeadAdvancedFilter } from '../../convex/_lib/validators/filters';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'WAP',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      updatedAt: Date.now(),
    }),
  );
  return { t, emp, as };
}

/** « MQL sans propriétaire » — the acceptance-criteria list. */
const MQL_NO_OWNER: LeadAdvancedFilter = {
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
        { field: { kind: 'standard', field: 'ownerIds' }, operator: 'isEmpty' },
      ],
    },
  ],
};

const stageIs = (stage: string): LeadAdvancedFilter => ({
  combinator: 'and',
  groups: [
    {
      combinator: 'and',
      rules: [
        {
          field: { kind: 'standard', field: 'lifecycleStage' },
          operator: 'equals',
          value: [stage],
        },
      ],
    },
  ],
});

/** Wait for the scheduled full-recalculation chain (runAfter(0) pages) to finish. */
async function settleRecalc(t: T, listId: Id<'leadLists'>) {
  for (let i = 0; i < 100; i++) {
    const list = await t.run((ctx) => ctx.db.get(listId));
    if (!list || list.recalc === undefined) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('recalc did not settle');
}

/** Drive fake timers + microtasks until `done` reports true (jest.useFakeTimers active). */
async function pumpUntil(done: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    jest.runAllTimers();
    for (let j = 0; j < 50; j++) await Promise.resolve();
    if (await done()) return;
  }
  throw new Error('condition not reached under fake timers');
}

const memberRow = (t: T, listId: Id<'leadLists'>, leadId: Id<'leads'>) =>
  t.run((ctx) =>
    ctx.db
      .query('leadListMembers')
      .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', leadId))
      .first(),
  );

async function memberCountOf(as: ReturnType<typeof asIdentity>, listId: Id<'leadLists'>) {
  const lists = await as.query(api.features.crm.queries.listLeadLists, {});
  return lists.find((list) => list._id === listId)?.memberCount;
}

describe('dynamic lists', () => {
  test('a lead enters and leaves on the very write that changes its fields', async () => {
    const { t, emp, as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'MQL sans propriétaire',
      kind: 'dynamic',
      criteria: MQL_NO_OWNER,
    });
    await settleRecalc(t, listId);

    // Creation matching the criteria: member immediately, no recalculation.
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      lifecycleStage: 'mql',
    });
    expect(await memberRow(t, listId, leadId)).not.toBeNull();
    expect(await memberCountOf(as, listId)).toBe(1);

    // Assigning an owner breaks the criteria: out on the same write.
    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId,
      ownerIds: [emp.userId],
    });
    expect(await memberRow(t, listId, leadId)).toBeNull();
    expect(await memberCountOf(as, listId)).toBe(0);

    // Back to matching: in again.
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, ownerIds: [] });
    expect(await memberRow(t, listId, leadId)).not.toBeNull();

    // Soft-deleting the lead removes it from the list.
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });
    expect(await memberRow(t, listId, leadId)).toBeNull();
  });

  test('creation fills the list from existing leads; a criteria edit reconciles', async () => {
    const { t, as } = await setup();
    const mql = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Marie',
      lastName: 'Curie',
      lifecycleStage: 'mql',
    });
    const sql = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Grace',
      lastName: 'Hopper',
      lifecycleStage: 'sql',
    });

    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'MQL',
      kind: 'dynamic',
      criteria: stageIs('mql'),
    });
    await settleRecalc(t, listId);
    expect(await memberRow(t, listId, mql)).not.toBeNull();
    expect(await memberRow(t, listId, sql)).toBeNull();
    const row = (await as.query(api.features.crm.queries.listLeadLists, {})).find(
      (l) => l._id === listId,
    );
    expect(row).toMatchObject({ kind: 'dynamic', memberCount: 1 });
    expect(row?.lastRecalcAt).not.toBeNull();

    // New criteria: membership flips to the SQL lead after the reconciliation.
    await as.mutation(api.features.crm.mutations.updateLeadList, {
      listId,
      criteria: stageIs('sql'),
    });
    await settleRecalc(t, listId);
    expect(await memberRow(t, listId, mql)).toBeNull();
    expect(await memberRow(t, listId, sql)).not.toBeNull();
    expect(await memberCountOf(as, listId)).toBe(1);
  });

  test('membership changes dispatch list_membership_changed to workflows', async () => {
    const { t, as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'MQL',
      kind: 'dynamic',
      criteria: stageIs('mql'),
    });
    await settleRecalc(t, listId);

    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Wf liste dynamique',
      trigger: { type: 'list_membership_changed', change: 'added', listId },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });

    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Tim',
      lastName: 'Berners-Lee',
      lifecycleStage: 'mql',
    });
    expect(await memberRow(t, listId, leadId)).not.toBeNull();
    const runs = await t.run((ctx) => ctx.db.query('workflowRuns').collect());
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ workflowId, leadId, triggerType: 'list_membership_changed' });
  });

  test('deleting a dynamic list together with its leads deletes each membership once', async () => {
    const { t, as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'MQL',
      kind: 'dynamic',
      criteria: stageIs('mql'),
    });
    await settleRecalc(t, listId);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Alan',
      lastName: 'Turing',
      lifecycleStage: 'mql',
    });
    expect(await memberRow(t, listId, leadId)).not.toBeNull();

    // The soft-delete trigger also drops the membership — the loop must not delete it twice.
    const result = await as.mutation(api.features.crm.mutations.deleteLeadList, {
      listId,
      deleteLeads: true,
    });
    expect(result).toMatchObject({ done: true, deletedLeads: 1 });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.deletedAt).toBeDefined();
    expect(await memberRow(t, listId, leadId)).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(listId))).toBeNull();
  });

  test('no manual membership: CSV import into a dynamic list is refused', async () => {
    const { as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Dyn',
      kind: 'dynamic',
      criteria: stageIs('mql'),
    });
    await expect(
      as.mutation(api.features.crm.mutations.importLeads, {
        rows: [{ firstName: 'Max', lastName: 'Import', email: 'max@example.com' }],
        listId,
      }),
    ).rejects.toThrow('list_is_dynamic');
  });

  test('criteria are validated and the dynamic-list cap is enforced', async () => {
    const { as } = await setup();
    await expect(
      as.mutation(api.features.crm.mutations.createLeadList, {
        name: 'Sans critères',
        kind: 'dynamic',
        criteria: { combinator: 'and', groups: [] },
      }),
    ).rejects.toThrow('dynamic_list_criteria_required');
    await expect(
      as.mutation(api.features.crm.mutations.createLeadList, {
        name: 'Auto-référence',
        kind: 'dynamic',
        criteria: {
          combinator: 'and',
          groups: [
            {
              combinator: 'and',
              rules: [
                { field: { kind: 'standard', field: 'listIds' }, operator: 'equals', value: ['x'] },
              ],
            },
          ],
        },
      }),
    ).rejects.toThrow('dynamic_list_criteria_list_rule');
    // Static lists refuse criteria.
    await expect(
      as.mutation(api.features.crm.mutations.createLeadList, {
        name: 'Statique',
        criteria: stageIs('mql'),
      }),
    ).rejects.toThrow('list_not_dynamic');

    await as.mutation(api.features.config.mutations.updateConfig, { listsMaxDynamicLists: 1 });
    await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Première',
      kind: 'dynamic',
      criteria: stageIs('mql'),
    });
    await expect(
      as.mutation(api.features.crm.mutations.createLeadList, {
        name: 'Deuxième',
        kind: 'dynamic',
        criteria: stageIs('sql'),
      }),
    ).rejects.toThrow('dynamic_list_cap_reached');
  });

  test('relative-date criteria book a time-drift recalculation', async () => {
    const { t, as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Ouvreurs 30 j',
      kind: 'dynamic',
      criteria: {
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
      },
    });
    await settleRecalc(t, listId);
    const list = await t.run((ctx) => ctx.db.get(listId));
    expect(list?.nextRecalcId).toBeDefined();
    const job = await t.run((ctx) => list?.nextRecalcId && ctx.db.system.get(list.nextRecalcId));
    expect(job?.name).toContain('startScheduledListRecalc');

    // Deleting the list cancels the pending drift job.
    await as.mutation(api.features.crm.mutations.deleteLeadList, { listId, deleteLeads: false });
    const after = await t.run((ctx) => list?.nextRecalcId && ctx.db.system.get(list.nextRecalcId));
    expect(after?.state.kind).toBe('canceled');
  });

  test('the drift job reruns the recalculation without cancelling itself', async () => {
    const { t, as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Nikola',
      lastName: 'Tesla',
      lifecycleStage: 'mql',
    });
    jest.useFakeTimers();
    try {
      const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
        name: 'Ouvreurs 30 j',
        kind: 'dynamic',
        criteria: {
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
        },
      });
      const listDoc = () => t.run((ctx) => ctx.db.get(listId));
      await pumpUntil(async () => (await listDoc())?.recalc === undefined);
      const before = await listDoc();
      const driftId = before?.nextRecalcId;
      if (!driftId) throw new Error('no drift job booked');

      // Advance 24h: the drift job must run to completion, not cancel itself.
      await pumpUntil(async () => {
        const job = await t.run((ctx) => ctx.db.system.get(driftId));
        const settled = job?.state.kind === 'success' || job?.state.kind === 'canceled';
        return settled && (await listDoc())?.recalc === undefined;
      });
      const job = await t.run((ctx) => ctx.db.system.get(driftId));
      expect(job?.state.kind).toBe('success');
      const after = await listDoc();
      expect(after?.lastRecalcAt).toBeGreaterThan(before?.lastRecalcAt ?? 0);
      expect(after?.nextRecalcId).toBeDefined();
      expect(after?.nextRecalcId).not.toBe(driftId);
    } finally {
      jest.useRealTimers();
    }
  });
});
