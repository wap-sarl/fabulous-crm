import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { leadsByOwner } from '../../convex/lib/leadAggregates';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

async function countByOwner(t: T, owner: Id<'users'> | null) {
  return await t.run(async (ctx) => {
    return await leadsByOwner.count(ctx, {
      namespace: owner,
      bounds: { lower: { key: 0, inclusive: true }, upper: { key: 0, inclusive: true } },
    });
  });
}

describe('countLeadsByLifecycleStage (aggregate-backed)', () => {
  test('creations land in their status bucket and the total', async () => {
    const { as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@example.com',
    });
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'B',
      lastName: 'B',
      email: 'b@example.com',
      lifecycleStage: 'customer',
    });

    const counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.total).toBe(2);
    expect(counts.byStage.lead).toBe(1);
    expect(counts.byStage.customer).toBe(1);
  });

  test('a status change moves the lead between buckets', async () => {
    const { as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@example.com',
    });

    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId,
      lifecycleStage: 'sql',
    });

    const counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.total).toBe(1);
    expect(counts.byStage.lead).toBe(0);
    expect(counts.byStage.sql).toBe(1);
  });

  test('a soft delete leaves the live counts', async () => {
    const { as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@example.com',
    });
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'B',
      lastName: 'B',
      email: 'b@example.com',
    });

    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });

    const counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.total).toBe(1);
    expect(counts.byStage.lead).toBe(1);
  });

  test('the CSV import upsert counts each lead exactly once', async () => {
    const { as } = await setup();
    const rows = [
      { firstName: 'A', lastName: 'A', email: 'a@example.com' },
      { firstName: 'B', lastName: 'B', email: 'b@example.com' },
    ];
    await as.mutation(api.features.crm.mutations.importLeads, { rows });
    // Re-import: updates, not duplicates.
    await as.mutation(api.features.crm.mutations.importLeads, { rows });

    const counts = await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(counts.total).toBe(2);
  });
});

describe('leadsByOwner aggregate', () => {
  test('assignment moves a lead between owner namespaces', async () => {
    const { t, emp, as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@example.com',
    });
    expect(await countByOwner(t, null)).toBe(1);
    expect(await countByOwner(t, emp.userId)).toBe(0);

    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId,
      assignedTo: emp.userId,
    });
    expect(await countByOwner(t, null)).toBe(0);
    expect(await countByOwner(t, emp.userId)).toBe(1);
  });
});
