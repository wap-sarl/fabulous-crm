import { expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { countDb } from '../support/dbCounter';
import {
  asIdentity,
  createTestConvex,
  matchingLeads,
  seedConfig,
  seedEmployee,
  seedLead,
} from './helpers';

test('the leads matching a filter are gathered page by page: no call reads the table whole', async () => {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  await seedConfig(t);
  const as = asIdentity(t, emp.identity);
  // 1 150 contacts: every tenth is a customer, every third has no phone, the last fifty are deleted.
  const ids: Id<'leads'>[] = [];
  for (let i = 0; i < 1150; i++) {
    ids.push(
      await seedLead(t, {
        email: `lead${i}@example.com`,
        phone: i % 3 === 0 ? undefined : '0102030405',
        lifecycleStage: i % 10 === 0 ? 'customer' : 'lead',
        deletedAt: i >= 1100 ? 1 : undefined,
      }),
    );
  }

  // Every fourth has no address.
  await t.run(async (ctx) => {
    for (let i = 0; i < ids.length; i += 4) await ctx.db.patch(ids[i], { email: undefined });
  });

  const all = await matchingLeads(as);
  expect(all).toMatchObject({ total: 1100, withEmail: 825, withPhone: 733, pages: 3 });
  expect(all.leadIds).toEqual(ids.slice(0, 1100));

  const customers = await matchingLeads(as, { lifecycleStages: ['customer'] });
  expect(customers).toMatchObject({ total: 110, withEmail: 55, withPhone: 73, pages: 3 });
  expect(customers.leadIds).toEqual(ids.filter((_, i) => i % 10 === 0 && i < 1100));

  const first = { cursor: null as string | null };
  const cost = await countDb(async () => {
    first.cursor = (
      await as.query(api.features.leads.queries.matchingLeadsPage, { cursor: null })
    ).cursor;
  });
  expect(cost.reads.leads).toBe(500);
  expect(first.cursor).not.toBeNull();
});

test('a page looks up the lists of its own leads only', async () => {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  await seedConfig(t);
  const as = asIdentity(t, emp.identity);
  const listId = await as.mutation(api.features.leadLists.mutations.createLeadList, {
    name: 'Salon',
  });
  await as.mutation(api.features.leads.mutations.importLeads, {
    rows: [
      { firstName: 'Ada', lastName: 'A', email: 'ada@example.com' },
      { firstName: 'Bob', lastName: 'B', email: 'bob@example.com' },
    ],
    listId,
  });
  await as.mutation(api.features.leads.mutations.importLeads, {
    rows: [{ firstName: 'Cy', lastName: 'C', email: 'cy@example.com' }],
  });
  expect(await matchingLeads(as, { listIds: [listId] })).toMatchObject({ total: 2, pages: 1 });
  expect(await matchingLeads(as)).toMatchObject({ total: 3 });
});
