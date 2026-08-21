import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee, type SeededEmployee, type T } from './helpers';

async function setup(): Promise<{ t: T; emp: SeededEmployee }> {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, emp };
}

describe('createLead', () => {
  test('normalizes the email, starts with empty consent and a consent token', async () => {
    const { t, emp } = await setup();
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      {
        firstName: '  Marie ',
        lastName: ' Curie ',
        email: '  Marie.Curie@Example.COM ',
      },
    );
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.firstName).toBe('Marie');
    expect(lead?.lastName).toBe('Curie');
    expect(lead?.email).toBe('marie.curie@example.com');
    expect(lead?.marketingConsent).toEqual([]);
    expect(lead?.consentToken).toMatch(/^[0-9a-f]{32,}$/);
    expect(lead?.status).toBe('nouveau');
    expect(lead?.createdBy).toBe(emp.userId);
  });

  test('writes a create audit-log entry', async () => {
    const { t, emp } = await setup();
    const leadId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createLead,
      {
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
      },
    );
    const logs = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: 'lead',
      entityId: leadId,
      action: 'create',
      userId: emp.userId,
    });
  });
});

describe('updateLead', () => {
  test('patches fields and audit-logs the diff', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@example.com',
    });
    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId,
      status: 'contacte',
      email: 'JEAN@example.com',
    });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.status).toBe('contacte');
    expect(lead?.email).toBe('jean@example.com');
    const updateLogs = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter((l) => l.action === 'update'),
    );
    expect(updateLogs).toHaveLength(1);
    expect((updateLogs[0].metadata as { changes: Record<string, unknown> }).changes.status).toEqual(
      { old: 'nouveau', new: 'contacte' },
    );
  });

  test('rejects a soft-deleted lead', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'X',
      lastName: 'Y',
      email: 'x@example.com',
    });
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });
    await expect(
      as.mutation(api.features.crm.mutations.updateLead, { leadId, status: 'contacte' }),
    ).rejects.toThrow('lead_not_found');
  });
});

describe('deleteLead / deleteLeads', () => {
  test('soft-deletes: the row survives with deletedAt set', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'B',
      email: 'del@example.com',
    });
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead).not.toBeNull();
    expect(lead?.deletedAt).toBeGreaterThan(0);
  });

  test('bulk delete dedups ids, skips already-deleted, reports the count', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const a = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@example.com',
    });
    const b = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'B',
      lastName: 'B',
      email: 'b@example.com',
    });
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId: a });
    const result = await as.mutation(api.features.crm.mutations.deleteLeads, {
      leadIds: [a, b, b],
    });
    expect(result).toEqual({ deleted: 1 });
  });
});

describe('importLeads (CSV upsert)', () => {
  test('inserts new emails, updates existing ones without resetting status', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const existingId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Old',
      lastName: 'Name',
      email: 'known@example.com',
    });
    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId: existingId,
      status: 'interesse',
    });

    const result = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        { firstName: 'New', lastName: 'Person', email: 'new@example.com' },
        // Same email, different case/whitespace → must match the existing lead.
        { firstName: 'Updated', lastName: 'Name', email: ' KNOWN@example.com ' },
      ],
    });
    expect(result).toMatchObject({ created: 1, updated: 1, errors: [] });

    const existing = await t.run((ctx) => ctx.db.get(existingId));
    expect(existing?.firstName).toBe('Updated');
    // The CSV provided no status column → the existing status is preserved.
    expect(existing?.status).toBe('interesse');
  });

  test('revives a soft-deleted lead matched by email', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ghost',
      lastName: 'Lead',
      email: 'ghost@example.com',
    });
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });

    const result = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [{ firstName: 'Ghost', lastName: 'Returns', email: 'ghost@example.com' }],
    });
    expect(result).toMatchObject({ created: 0, updated: 1 });
    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.deletedAt).toBeUndefined();
    expect(lead?.lastName).toBe('Returns');
  });

  test('a row without an email is always inserted', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const result = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        { firstName: 'No', lastName: 'Mail', email: '' },
        { firstName: 'No', lastName: 'Mail', email: '' },
      ],
    });
    expect(result).toMatchObject({ created: 2, updated: 0 });
    const leads = await t.run(async (ctx) =>
      (await ctx.db.query('leads').collect()).filter((l: Doc<'leads'>) => l.lastName === 'Mail'),
    );
    expect(leads).toHaveLength(2);
  });
});
