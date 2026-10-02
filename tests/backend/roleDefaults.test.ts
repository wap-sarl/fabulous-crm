import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { uniformAccess } from '../../convex/_lib/validators/access';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const LATER = NOW + 10 * 60 * 1000;
beforeEach(() => {
  pinClock(NOW);
});

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  return {
    t,
    admin,
    as: asIdentity(t, admin.identity),
    asMember: asIdentity(t, member.identity),
  };
}

const roles = (t: T) => t.run((ctx) => ctx.db.query('roles').collect());

const roleAudits = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect()).filter((row) => row.entityType === 'role'),
  );

describe('seeding the built-in roles', () => {
  test('answers null and writes the three roles of the ladder, signed by the caller', async () => {
    const { t, as, admin } = await setup();

    expect(await as.mutation(api.features.roles.mutations.ensureDefaults, {})).toBeNull();

    const stamps = {
      builtIn: true,
      updatedAt: NOW,
      createdBy: admin.userId,
      updatedBy: admin.userId,
    };
    expect((await roles(t)).map(({ _id, _creationTime, ...role }) => role)).toEqual([
      { key: 'admin', label: 'Administrateur', access: uniformAccess('all', true), ...stamps },
      { key: 'manager', label: 'Manager', access: uniformAccess('team', false), ...stamps },
      { key: 'member', label: 'Membre', access: uniformAccess('own', false), ...stamps },
    ]);
    // A seed is not an edit: the journal stays silent.
    expect(await roleAudits(t)).toEqual([]);
  });

  test('a second call answers null and leaves the rows as they are', async () => {
    const { t, as } = await setup();
    await as.mutation(api.features.roles.mutations.ensureDefaults, {});
    const before = await roles(t);
    jest.setSystemTime(new Date(LATER));

    expect(await as.mutation(api.features.roles.mutations.ensureDefaults, {})).toBeNull();

    expect(await roles(t)).toEqual(before);
  });

  test('only the missing roles are added: an edited one and a custom one are kept', async () => {
    const { t, as, admin } = await setup();
    await as.mutation(api.features.roles.mutations.updateRole, {
      key: 'manager',
      label: 'Responsable',
      access: { ...uniformAccess('team', false), campaigns: 'all' },
    });
    const chief = await as.mutation(api.features.roles.mutations.createRole, {
      label: 'Chef',
      access: uniformAccess('all', true),
    });
    const chiefUser = await seedEmployee(t, { email: 'chef@example.com', role: chief });
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query('roles')
        .withIndex('by_key', (q) => q.eq('key', 'member'))
        .unique();
      if (member) await ctx.db.delete(member._id);
    });
    jest.setSystemTime(new Date(LATER));

    // A custom role with the settings switch is enough to call it.
    expect(
      await asIdentity(t, chiefUser.identity).mutation(
        api.features.roles.mutations.ensureDefaults,
        {},
      ),
    ).toBeNull();

    const byKey = new Map((await roles(t)).map((role) => [role.key, role]));
    expect([...byKey.keys()].sort()).toEqual(['admin', 'chef', 'manager', 'member']);
    expect(byKey.get('manager')).toMatchObject({
      label: 'Responsable',
      access: { ...uniformAccess('team', false), campaigns: 'all' },
      builtIn: true,
      updatedAt: NOW,
      updatedBy: admin.userId,
    });
    expect(byKey.get('chef')).toMatchObject({ label: 'Chef', builtIn: false, updatedAt: NOW });
    expect(byKey.get('member')).toMatchObject({
      label: 'Membre',
      access: uniformAccess('own', false),
      builtIn: true,
      updatedAt: LATER,
      createdBy: chiefUser.userId,
      updatedBy: chiefUser.userId,
    });
  });

  test('is refused without the settings access, and nothing is seeded', async () => {
    const { t, asMember } = await setup();
    await expect(
      asMember.mutation(api.features.roles.mutations.ensureDefaults, {}),
    ).rejects.toThrow('Unauthorized: settings access');
    expect(await roles(t)).toEqual([]);
  });
});
