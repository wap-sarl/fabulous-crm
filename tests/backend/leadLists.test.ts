import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee, seedLead } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

function rows(...names: string[]) {
  return names.map((name) => ({
    firstName: name,
    lastName: 'Test',
    email: `${name.toLowerCase()}@example.com`,
  }));
}

async function memberCountOf(as: ReturnType<typeof asIdentity>, listId: Id<'leadLists'>) {
  const lists = await as.query(api.features.crm.queries.listLeadLists, {});
  return lists.find((list) => list._id === listId)?.memberCount;
}

describe('listLeadLists member counts', () => {
  test('import into a list is counted, idempotently across re-imports', async () => {
    const { as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Prospects',
    });

    await as.mutation(api.features.crm.mutations.importLeads, {
      rows: rows('Anna', 'Bruno', 'Chloe'),
      listId,
    });
    expect(await memberCountOf(as, listId)).toBe(3);

    // Re-importing the same emails upserts the leads and must not double-count.
    await as.mutation(api.features.crm.mutations.importLeads, {
      rows: rows('Anna', 'Bruno'),
      listId,
    });
    expect(await memberCountOf(as, listId)).toBe(3);
  });

  test('deleting a list drains its count without touching other lists', async () => {
    const { as } = await setup();
    const keepId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Keep',
    });
    const dropId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Drop',
    });
    await as.mutation(api.features.crm.mutations.importLeads, {
      rows: rows('Anna', 'Bruno'),
      listId: keepId,
    });
    await as.mutation(api.features.crm.mutations.importLeads, {
      rows: rows('Denis'),
      listId: dropId,
    });

    const result = await as.mutation(api.features.crm.mutations.deleteLeadList, {
      listId: dropId,
      deleteLeads: false,
    });
    expect(result.done).toBe(true);

    const lists = await as.query(api.features.crm.queries.listLeadLists, {});
    expect(lists.find((list) => list._id === dropId)).toBeUndefined();
    expect(await memberCountOf(as, keepId)).toBe(2);
  });

  test('backfill registers junction rows that predate the aggregate', async () => {
    const { t, emp, as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Legacy',
    });

    // Simulate pre-aggregate data: raw junction inserts that bypass the helper.
    for (let i = 0; i < 3; i++) {
      const leadId = await seedLead(t, { email: `legacy-${i}@example.com` });
      await t.run(async (ctx) => {
        await ctx.db.insert('leadListMembers', { listId, leadId, addedBy: emp.userId });
      });
    }
    expect(await memberCountOf(as, listId)).toBe(0);

    let cursor: string | undefined;
    for (;;) {
      const page = await t.mutation(
        internal.features.crm.internal.backfillLeadListMemberCounts,
        cursor ? { cursor } : {},
      );
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(await memberCountOf(as, listId)).toBe(3);

    // Idempotent: re-running the backfill must not double-count.
    await t.mutation(internal.features.crm.internal.backfillLeadListMemberCounts, {});
    expect(await memberCountOf(as, listId)).toBe(3);
  });
});
