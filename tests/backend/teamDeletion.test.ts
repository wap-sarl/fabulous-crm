import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
const LATER = NOW + 10 * 60 * 1000;
beforeEach(() => {
  pinClock(NOW);
});

/** Nord has manager Marc and rep Nina, Sud has rep Sam; Nina owns a contact. */
async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, {
    email: 'admin@example.com',
    role: 'admin',
    firstName: 'Ada',
  });
  const marc = await seedEmployee(t, {
    email: 'marc@example.com',
    role: 'manager',
    firstName: 'Marc',
  });
  const nina = await seedEmployee(t, {
    email: 'nina@example.com',
    role: 'member',
    firstName: 'Nina',
  });
  const sam = await seedEmployee(t, { email: 'sam@example.com', role: 'member', firstName: 'Sam' });
  const as = asIdentity(t, admin.identity);
  const nord = await as.mutation(api.features.teams.mutations.createTeam, {
    name: 'Nord',
    memberIds: [marc.userId, nina.userId],
  });
  const sud = await as.mutation(api.features.teams.mutations.createTeam, {
    name: 'Sud',
    memberIds: [sam.userId],
  });
  const ninas = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Léa',
    lastName: 'Martin',
    email: 'lea@example.com',
    ownerIds: [nina.userId],
  });
  jest.setSystemTime(new Date(LATER));
  return {
    t,
    admin,
    marc,
    nina,
    as,
    asMarc: asIdentity(t, marc.identity),
    asNina: asIdentity(t, nina.identity),
    nord,
    sud,
    ninas,
  };
}

const auditOf = (t: T, teamId: Id<'teams'>) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'team').eq('entityId', teamId))
        .collect()
    ).map(({ action, userId, timestamp }) => ({ action, userId, timestamp })),
  );

const visibleLeads = (as: ReturnType<typeof asIdentity>) =>
  as
    .query(api.features.leads.queries.listLeadsPaginated, {
      paginationOpts: { numItems: 50, cursor: null },
    })
    .then((result) => result.page.map((lead) => lead._id));

describe('deleting a team', () => {
  test('answers null, keeps the row as deleted, takes it off the list and is audited', async () => {
    const { t, as, admin, marc, nina, nord, sud } = await setup();

    expect(await as.mutation(api.features.teams.mutations.deleteTeam, { teamId: nord })).toBeNull();

    expect(await t.run((ctx) => ctx.db.get(nord))).toMatchObject({
      name: 'Nord',
      memberIds: [marc.userId, nina.userId],
      deletedAt: LATER,
      updatedAt: LATER,
      createdBy: admin.userId,
      updatedBy: admin.userId,
    });
    expect((await t.run((ctx) => ctx.db.get(sud)))?.deletedAt).toBeUndefined();
    expect(await auditOf(t, nord)).toEqual([
      { action: 'create', userId: admin.userId, timestamp: NOW },
      { action: 'delete', userId: admin.userId, timestamp: LATER },
    ]);
    const teams = await as.query(api.features.teams.queries.listTeams, {});
    expect(teams.map((team) => team.name)).toEqual(['Sud']);
  });

  test('its manager loses that perimeter at once', async () => {
    const { as, asMarc, nord, ninas } = await setup();
    expect(await visibleLeads(asMarc)).toEqual([ninas]);
    const withoutTeam = async () =>
      (await as.query(api.features.roles.queries.listRoles, {})).map((role) => [
        role.key,
        role.usersWithoutTeam,
      ]);
    expect(await withoutTeam()).toEqual([
      ['admin', 1],
      ['manager', 0],
      ['member', 0],
    ]);

    await as.mutation(api.features.teams.mutations.deleteTeam, { teamId: nord });

    expect(await visibleLeads(asMarc)).toEqual([]);
    expect(await visibleLeads(as)).toEqual([ninas]);
    expect(await withoutTeam()).toEqual([
      ['admin', 1],
      ['manager', 1],
      ['member', 1],
    ]);
  });

  test('a team already deleted, or one that is gone, is refused', async () => {
    const { t, as, nord, sud } = await setup();
    await as.mutation(api.features.teams.mutations.deleteTeam, { teamId: nord });
    await expect(
      as.mutation(api.features.teams.mutations.deleteTeam, { teamId: nord }),
    ).rejects.toMatchObject({ data: { code: 'team_not_found' } });
    expect((await auditOf(t, nord)).map((row) => row.action)).toEqual(['create', 'delete']);

    await t.run((ctx) => ctx.db.delete(sud));
    await expect(
      as.mutation(api.features.teams.mutations.deleteTeam, { teamId: sud }),
    ).rejects.toMatchObject({ data: { code: 'team_not_found' } });
  });

  test('is refused without the settings access, for its manager as for a member', async () => {
    const { t, asMarc, asNina, nord } = await setup();
    for (const as of [asMarc, asNina]) {
      await expect(
        as.mutation(api.features.teams.mutations.deleteTeam, { teamId: nord }),
      ).rejects.toThrow('Unauthorized: settings access');
    }
    expect((await t.run((ctx) => ctx.db.get(nord)))?.deletedAt).toBeUndefined();
  });
});
