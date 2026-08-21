import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

/**
 * Authorization wrappers (convex/_lib/auth.ts), exercised through the real
 * Better Auth component: identity claims → session lookup → employee
 * resolution. No mocks — the production code path runs end to end.
 */
describe('employeeQuery / employeeMutation', () => {
  test('rejects an unauthenticated call', async () => {
    const t = createTestConvex();
    await expect(t.query(api.features.users.queries.listEmployees, {})).rejects.toThrow(
      'Unauthenticated',
    );
    await expect(
      t.mutation(api.features.crm.mutations.createLead, {
        firstName: 'A',
        lastName: 'B',
        email: 'x@example.com',
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  test('accepts a signed-in member employee', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'alice@example.com' });
    const employees = await asIdentity(t, emp.identity).query(
      api.features.users.queries.listEmployees,
      {},
    );
    expect(employees.some((e: { _id: string }) => e._id === emp.userId)).toBe(true);
  });

  test('rejects an identity whose session has expired', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'expired@example.com', sessionTtlMs: -1000 });
    await expect(
      asIdentity(t, emp.identity).query(api.features.users.queries.listEmployees, {}),
    ).rejects.toThrow('Unauthenticated');
  });

  test('rejects a soft-deleted employee with a live session', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'gone@example.com', deletedAt: Date.now() });
    await expect(
      asIdentity(t, emp.identity).query(api.features.users.queries.listEmployees, {}),
    ).rejects.toThrow('Unauthenticated');
  });
});

describe('adminQuery / adminMutation', () => {
  test('rejects a member on an admin query and mutation', async () => {
    const t = createTestConvex();
    const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
    await expect(
      asIdentity(t, member.identity).query(api.features.invitations.queries.listInvitations, {}),
    ).rejects.toThrow('Unauthorized: admins only');
    await expect(
      asIdentity(t, member.identity).mutation(
        api.features.leadProperties.mutations.createDefinition,
        { label: 'Spécialité', type: 'text', showInTable: false },
      ),
    ).rejects.toThrow('Unauthorized: admins only');
  });

  test('accepts an admin on the same routes', async () => {
    const t = createTestConvex();
    const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
    const invitations = await asIdentity(t, admin.identity).query(
      api.features.invitations.queries.listInvitations,
      {},
    );
    expect(invitations).toEqual([]);
    const defId = await asIdentity(t, admin.identity).mutation(
      api.features.leadProperties.mutations.createDefinition,
      { label: 'Spécialité', type: 'text', showInTable: false },
    );
    expect(defId).toBeDefined();
  });
});
