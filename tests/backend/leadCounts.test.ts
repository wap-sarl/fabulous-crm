import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { leadsByOwner } from '../../convex/lib/leadAggregates';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

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

describe('countLeadsByStatus (aggregate-backed)', () => {
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
      status: 'converti',
    });

    const counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
    expect(counts.total).toBe(2);
    expect(counts.byStatus.nouveau).toBe(1);
    expect(counts.byStatus.converti).toBe(1);
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
      status: 'interesse',
    });

    const counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
    expect(counts.total).toBe(1);
    expect(counts.byStatus.nouveau).toBe(0);
    expect(counts.byStatus.interesse).toBe(1);
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

    const counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
    expect(counts.total).toBe(1);
    expect(counts.byStatus.nouveau).toBe(1);
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

    const counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
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

describe('backfillLeadAggregates', () => {
  test('registers raw pre-aggregate rows, idempotently', async () => {
    const { t, as } = await setup();
    // Raw inserts bypass the trigger wrapper — exactly the legacy situation.
    for (let i = 0; i < 3; i++) {
      await seedLead(t, { email: `legacy-${i}@example.com` });
    }
    let counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
    expect(counts.total).toBe(0);

    let cursor: string | undefined;
    for (;;) {
      const page = await t.mutation(
        internal.features.crm.internal.backfillLeadAggregates,
        cursor ? { cursor } : {},
      );
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
    expect(counts.total).toBe(3);

    await t.mutation(internal.features.crm.internal.backfillLeadAggregates, {});
    counts = await as.query(api.features.crm.queries.countLeadsByStatus, {});
    expect(counts.total).toBe(3);
  });
});
