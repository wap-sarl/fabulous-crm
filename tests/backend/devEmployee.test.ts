import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const create = internal.seed.devEmployee.createDevEmployee;

function fresh(): T {
  const t = createTestConvex();
  pinClock(NOW);
  return t;
}

const users = (t: T) => t.run((ctx) => ctx.db.query('users').collect());

describe('the first employee of a development deployment', () => {
  test('is created with its address in lower case and its names trimmed, and the deployment counts as set up', async () => {
    const t = fresh();
    expect(await t.query(api.setup.queries.status, {})).toMatchObject({ setupComplete: false });

    const result = await t.mutation(create, {
      email: '  Ada.Lovelace@Example.com ',
      firstName: ' Ada ',
      lastName: ' Lovelace ',
    });

    expect(result).toEqual({ userId: expect.any(String), created: true });
    expect(await users(t)).toEqual([
      {
        _id: result.userId,
        _creationTime: expect.any(Number),
        type: 'employee',
        email: 'ada.lovelace@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        birthDate: '1970-01-01',
        jobTitle: 'CRM',
        phone: '',
        address: { street: '', streetNumber: '', postalCode: '', city: '', country: 'FR' },
        updatedAt: NOW,
      },
    ]);
    expect(await t.query(api.setup.queries.status, {})).toMatchObject({ setupComplete: true });
  });

  test('an employee who already has the address is given back as it is, whatever the case', async () => {
    const t = fresh();
    const first = await t.mutation(create, {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    const again = await t.mutation(create, {
      email: 'ADA@example.com',
      firstName: 'Augusta',
      lastName: 'King',
    });

    expect(again).toEqual({ userId: first.userId, created: false });
    expect(await users(t)).toMatchObject([
      { _id: first.userId, email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
    ]);
  });

  test('an employee seeded with a role and a sign-in is given back, its role and sign-in untouched', async () => {
    const t = fresh();
    const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });

    expect(
      await t.mutation(create, { email: 'admin@example.com', firstName: 'A', lastName: 'B' }),
    ).toEqual({ userId: admin.userId, created: false });
    expect(await users(t)).toMatchObject([
      { _id: admin.userId, role: 'admin', authId: admin.authId, firstName: 'Test' },
    ]);
  });

  test('an employee in the bin does not count: a live one is created beside it', async () => {
    const t = fresh();
    const binned = await seedEmployee(t, { email: 'ada@example.com', deletedAt: NOW - 1000 });

    const result = await t.mutation(create, {
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    expect(result.created).toBe(true);
    expect(result.userId).not.toBe(binned.userId);
    const rows = await users(t);
    expect(rows).toHaveLength(2);
    expect(rows.find((u) => u._id === binned.userId)?.deletedAt).toBe(NOW - 1000);
    expect(rows.find((u) => u._id === result.userId)?.deletedAt).toBeUndefined();
  });
});
