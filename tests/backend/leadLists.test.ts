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

describe('advanced-filter list membership', () => {
  const membershipFilter = (listId: Id<'leadLists'>, operator: 'equals' | 'notEquals') => ({
    combinator: 'and' as const,
    groups: [
      {
        combinator: 'and' as const,
        rules: [
          {
            field: { kind: 'standard' as const, field: 'listIds' as const },
            operator,
            value: [listId],
          },
        ],
      },
    ],
  });

  test('« est membre de » follows list adds and removals, through the index', async () => {
    const { as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, { name: 'Cible' });
    await as.mutation(api.features.crm.mutations.importLeads, { rows: rows('Anna'), listId });
    await as.mutation(api.features.crm.mutations.importLeads, { rows: rows('Bruno') });

    const members = await as.query(api.features.crm.queries.listMatchingLeadIds, {
      advancedFilter: membershipFilter(listId, 'equals'),
    });
    expect(members.total).toBe(1);
    const outsiders = await as.query(api.features.crm.queries.listMatchingLeadIds, {
      advancedFilter: membershipFilter(listId, 'notEquals'),
    });
    expect(outsiders.total).toBe(1);

    // Removing the membership (list deleted, leads kept) flips the verdicts.
    await as.mutation(api.features.crm.mutations.deleteLeadList, { listId, deleteLeads: false });
    const after = await as.query(api.features.crm.queries.listMatchingLeadIds, {
      advancedFilter: membershipFilter(listId, 'equals'),
    });
    expect(after.total).toBe(0);
    const afterNot = await as.query(api.features.crm.queries.listMatchingLeadIds, {
      advancedFilter: membershipFilter(listId, 'notEquals'),
    });
    expect(afterNot.total).toBe(2);
  });
});
