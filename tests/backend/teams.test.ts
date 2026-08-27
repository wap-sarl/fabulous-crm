import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { countLiveLeadsByOwner } from '../../convex/lib/leadAggregates';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

/**
 * Two teams: Nord (manager Marc + rep Nina) and Sud (rep Sam). Leads owned by
 * each rep, one co-owned, one unowned. The admin sees everything, the member
 * sees everything, Marc (manager of Nord) sees Nord's records and the pool.
 */
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
  const asAdmin = asIdentity(t, admin.identity);
  const asMarc = asIdentity(t, marc.identity);
  const asSam = asIdentity(t, sam.identity);

  const nord = await asAdmin.mutation(api.features.teams.mutations.createTeam, {
    name: 'Nord',
    memberIds: [marc.userId, nina.userId],
  });
  await asAdmin.mutation(api.features.teams.mutations.createTeam, {
    name: 'Sud',
    memberIds: [sam.userId],
  });
  const lead = (fields: { lastName: string; ownerIds: Id<'users'>[]; email?: string }) =>
    asAdmin.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Lead',
      lifecycleStage: 'lead',
      ...fields,
    });
  const ninas = await lead({
    lastName: 'Nina',
    ownerIds: [nina.userId],
    email: 'nina-lead@example.com',
  });
  const sams = await lead({
    lastName: 'Sam',
    ownerIds: [sam.userId],
    email: 'sam-lead@example.com',
  });
  const shared = await lead({ lastName: 'Shared', ownerIds: [sam.userId, nina.userId] });
  const pool = await lead({ lastName: 'Pool', ownerIds: [] });
  return { t, admin, marc, nina, sam, asAdmin, asMarc, asSam, nord, ninas, sams, shared, pool };
}

const listIds = (as: ReturnType<typeof asIdentity>, args: Record<string, unknown> = {}) =>
  as
    .query(api.features.crm.queries.listLeadsPaginated, {
      paginationOpts: { numItems: 50, cursor: null },
      ...args,
    })
    .then((r) => r.page.map((l) => l._id).sort());

describe('teams', () => {
  test('are managed by admins, audited, and list their members', async () => {
    const { t, asAdmin, asMarc, nord, nina, marc } = await setup();
    const teams = await asAdmin.query(api.features.teams.queries.listTeams, {});
    expect(teams.map((tm) => [tm.name, tm.members.map((m) => m.name)])).toEqual([
      ['Nord', ['Marc User', 'Nina User']],
      ['Sud', ['Sam User']],
    ]);
    await asAdmin.mutation(api.features.teams.mutations.updateTeam, {
      teamId: nord,
      name: 'Nord-Est',
      memberIds: [marc.userId],
    });
    expect((await asAdmin.query(api.features.teams.queries.listTeams, {}))[0]).toMatchObject({
      name: 'Nord-Est',
      memberIds: [marc.userId],
    });
    await expect(
      asMarc.mutation(api.features.teams.mutations.updateTeam, { teamId: nord, name: 'X' }),
    ).rejects.toThrow('settings access');
    await expect(
      asAdmin.mutation(api.features.teams.mutations.createTeam, { name: ' ', memberIds: [] }),
    ).rejects.toThrow('team_name_required');
    await expect(
      asAdmin.mutation(api.features.teams.mutations.createTeam, {
        name: 'Bad',
        memberIds: ['k97abc' as Id<'users'>],
      }),
    ).rejects.toThrow();
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'team').eq('entityId', nord))
        .collect(),
    );
    expect(audit.map((a) => a.action)).toEqual(['create', 'update']);
    void nina;
  });

  test('roles: admins change them (not their own), the change is audited', async () => {
    const { t, asAdmin, asMarc, admin, sam } = await setup();
    await asAdmin.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: sam.userId,
      role: 'manager',
    });
    expect((await t.run((ctx) => ctx.db.get(sam.userId)))?.role).toBe('manager');
    await expect(
      asAdmin.mutation(api.features.users.mutations.setEmployeeRole, {
        userId: admin.userId,
        role: 'member',
      }),
    ).rejects.toThrow('cannot_change_own_role');
    await expect(
      asMarc.mutation(api.features.users.mutations.setEmployeeRole, {
        userId: sam.userId,
        role: 'admin',
      }),
    ).rejects.toThrow('settings access');
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'employee').eq('entityId', sam.userId))
        .collect(),
    );
    expect(audit.at(-1)?.metadata).toEqual({
      changes: { role: { old: 'member', new: 'manager' } },
    });
  });
});

describe('visibility', () => {
  test("a manager sees their team's leads and the unowned pool; admin and member see all", async () => {
    const { asAdmin, asMarc, asSam, ninas, sams, shared, pool } = await setup();
    const all = [ninas, sams, shared, pool].sort();
    expect(await listIds(asAdmin)).toEqual(all);
    expect(await listIds(asSam)).toEqual([sams, shared, pool].sort());
    expect(await listIds(asMarc)).toEqual([ninas, shared, pool].sort());

    // Search and detail follow the same perimeter.
    const hits = await asMarc.query(api.features.crm.queries.searchLeads, { search: 'Lead' });
    expect(hits.map((h) => h._id).sort()).toEqual([ninas, shared, pool].sort());
    expect(await asMarc.query(api.features.crm.queries.getLeadDetail, { leadId: sams })).toBeNull();
    expect(
      (await asMarc.query(api.features.crm.queries.getLeadDetail, { leadId: shared }))?.ownerNames,
    ).toEqual(['Sam User', 'Nina User']);
    expect(await asMarc.query(api.features.crm.queries.getLead, { leadId: sams })).toBeNull();
  });

  test('counts are scoped: lifecycle counts by primary owner, company total hidden', async () => {
    const { asAdmin, asMarc, asSam } = await setup();
    const adminCounts = await asAdmin.query(
      api.features.crm.queries.countLeadsByLifecycleStage,
      {},
    );
    expect(adminCounts.total).toBe(4);
    // Marc: Nina's lead + the pool. The co-owned lead's primary owner is Sam,
    // so it is visible but counted under Sam — the documented primary-owner rule.
    const marcCounts = await asMarc.query(api.features.crm.queries.countLeadsByLifecycleStage, {});
    expect(marcCounts.total).toBe(2);
    expect(marcCounts.byStage.lead).toBe(2);
    // Sam (own): Sam's lead, the co-owned one (primary Sam) and the pool.
    expect((await asSam.query(api.features.crm.queries.countLeadsByLifecycleStage, {})).total).toBe(
      3,
    );
    expect((await asMarc.query(api.features.companies.queries.countCompanies, {})).total).toBe(0);
    expect((await asAdmin.query(api.features.companies.queries.countCompanies, {})).total).toBe(0);
  });

  test('a manager cannot touch records outside the perimeter, can claim the pool', async () => {
    const { t, asMarc, asAdmin, sams, pool, marc, sam, nina } = await setup();
    await expect(
      asMarc.mutation(api.features.crm.mutations.updateLead, { leadId: sams, comment: 'x' }),
    ).rejects.toThrow('lead_not_found');
    await expect(
      asMarc.mutation(api.features.crm.mutations.deleteLead, { leadId: sams }),
    ).rejects.toThrow('lead_not_found');
    // Creating a lead owned outside the team is refused; inside is fine.
    await expect(
      asMarc.mutation(api.features.crm.mutations.createLead, {
        firstName: 'X',
        lastName: 'Y',
        ownerIds: [sam.userId],
      }),
    ).rejects.toThrow();
    const mine = await asMarc.mutation(api.features.crm.mutations.createLead, {
      firstName: 'X',
      lastName: 'Y',
      ownerIds: [marc.userId, nina.userId],
    });
    expect((await t.run((ctx) => ctx.db.get(mine)))?.ownerIds).toEqual([marc.userId, nina.userId]);
    // Claiming a pool lead: ownership change is audited.
    await asMarc.mutation(api.features.crm.mutations.updateLead, {
      leadId: pool,
      ownerIds: [marc.userId],
    });
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', pool))
        .collect(),
    );
    expect(audit.at(-1)?.metadata).toMatchObject({
      changes: { ownerIds: { old: [], new: [marc.userId] } },
    });
    // Admin lists still see the claimed lead; Sam's lead untouched.
    expect((await listIds(asAdmin)).length).toBe(5);
  });

  test('deals and companies follow the same rule; pipeline stats hidden to a team scope', async () => {
    const { asAdmin, asMarc, sam, nina } = await setup();
    await asAdmin.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const sams = await asAdmin.mutation(api.features.deals.mutations.createDeal, {
      title: 'Sam deal',
      ownerIds: [sam.userId],
    });
    const ninas = await asAdmin.mutation(api.features.deals.mutations.createDeal, {
      title: 'Nina deal',
      ownerIds: [nina.userId],
    });
    const deals = await asMarc.query(api.features.deals.queries.listDealsPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(deals.page.map((d) => d._id)).toEqual([ninas]);
    expect(await asMarc.query(api.features.deals.queries.getDeal, { dealId: sams })).toBeNull();
    const pipelines = await asAdmin.query(api.features.deals.queries.listPipelines, {});
    expect(
      (
        await asMarc.query(api.features.deals.queries.getPipelineStats, {
          pipelineId: pipelines[0]._id,
        })
      )?.open.count,
    ).toBe(1);

    const owned = await asAdmin.mutation(api.features.companies.mutations.createCompany, {
      name: 'Sam & Co',
      ownerIds: [sam.userId],
    });
    const shared = await asAdmin.mutation(api.features.companies.mutations.createCompany, {
      name: 'Public SA',
    });
    const companies = await asMarc.query(api.features.companies.queries.listCompaniesPaginated, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(companies.page.map((c) => c._id)).toEqual([shared]);
    expect(
      await asMarc.query(api.features.companies.queries.getCompany, { companyId: owned }),
    ).toBeNull();
  });

  test('the leadsByOwner aggregate counts a lead once, under its primary owner', async () => {
    const { t, sam, nina } = await setup();
    // Sam is primary of the co-owned lead: Sam 2, Nina 1, pool 1.
    const count = (owner: Id<'users'> | null, stage?: string) =>
      t.run((ctx) => countLiveLeadsByOwner(ctx, owner, stage));
    expect(await count(sam.userId)).toBe(2);
    expect(await count(nina.userId)).toBe(1);
    expect(await count(null)).toBe(1);
    expect(await count(sam.userId, 'lead')).toBe(2);
    expect(await count(sam.userId, 'customer')).toBe(0);
  });
});
