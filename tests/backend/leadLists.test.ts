import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

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
});
