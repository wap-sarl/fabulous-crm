import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { accessWarnings, uniformAccess } from '../../convex/_lib/validators/access';
import { DEFAULT_ROLES, roleKeyOf } from '../../convex/_lib/validators/roles';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

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
  const as = {
    admin: asIdentity(t, admin.identity),
    marc: asIdentity(t, marc.identity),
    nina: asIdentity(t, nina.identity),
    sam: asIdentity(t, sam.identity),
  };
  const nord = await as.admin.mutation(api.features.teams.mutations.createTeam, {
    name: 'Nord',
    memberIds: [marc.userId, nina.userId],
  });
  const sud = await as.admin.mutation(api.features.teams.mutations.createTeam, {
    name: 'Sud',
    memberIds: [sam.userId],
  });
  const lead = (lastName: string, ownerIds: Id<'users'>[]) =>
    as.admin.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Lead',
      lastName,
      lifecycleStage: 'lead',
      ownerIds,
    });
  const leads = {
    nina: await lead('Nina', [nina.userId]),
    sam: await lead('Sam', [sam.userId]),
    shared: await lead('Shared', [sam.userId, nina.userId]),
    pool: await lead('Pool', []),
  };
  return { t, admin, marc, nina, sam, as, nord, sud, leads };
}

const listLeadIds = (as: ReturnType<typeof asIdentity>) =>
  as
    .query(api.features.crm.queries.listLeadsPaginated, {
      paginationOpts: { numItems: 50, cursor: null },
    })
    .then((r) => r.page.map((l) => l._id).sort());

describe('roles', () => {
  test('defaults encode the ladder and the built-ins are always listed', async () => {
    const { as } = await setup();
    expect(DEFAULT_ROLES.map((r) => [r.key, r.access.leads, r.access.settings])).toEqual([
      ['admin', 'all', true],
      ['manager', 'team', false],
      ['member', 'own', false],
    ]);
    const roles = await as.admin.query(api.features.roles.queries.listRoles, {});
    expect(roles.map((r) => [r.key, r.builtIn, r.userCount])).toEqual([
      ['admin', true, 1],
      ['manager', true, 1],
      ['member', true, 2],
    ]);
    const me = await as.marc.query(api.auth.getCurrentUser, {});
    expect(me).toMatchObject({ role: 'manager', roleLabel: 'Manager' });
    expect(me?.access.leads).toBe('team');
    expect(me?.access.settings).toBe(false);
  });

  test('create, rename, edit cells, delete with replacement; admin locked; no lock-out', async () => {
    const { t, as, sam } = await setup();
    const key = await as.admin.mutation(api.features.roles.mutations.createRole, {
      label: 'Support Client',
      access: { ...uniformAccess('own', false), deals: 'none' },
    });
    expect(key).toBe('support_client');
    expect(roleKeyOf('Équipe Nord')).toBe('equipe_nord');
    await as.admin.mutation(api.features.roles.mutations.updateRole, {
      key,
      label: 'Support',
      access: { ...uniformAccess('all', false), deals: 'none' },
    });
    await as.admin.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: sam.userId,
      role: key,
    });
    const roles = await as.admin.query(api.features.roles.queries.listRoles, {});
    expect(roles.find((r) => r.key === key)).toMatchObject({
      label: 'Support',
      builtIn: false,
      userCount: 1,
    });
    expect((await as.sam.query(api.auth.getCurrentUser, {}))?.access.deals).toBe('none');

    // Guards.
    await expect(
      as.admin.mutation(api.features.roles.mutations.updateRole, {
        key: 'admin',
        access: uniformAccess('own', true),
      }),
    ).rejects.toThrow('role_admin_locked');
    await expect(
      as.admin.mutation(api.features.roles.mutations.deleteRole, { key: 'member' }),
    ).rejects.toThrow('role_built_in');
    await expect(
      as.admin.mutation(api.features.roles.mutations.deleteRole, { key }),
    ).rejects.toThrow('role_in_use');
    await expect(
      as.marc.mutation(api.features.roles.mutations.createRole, {
        label: 'X',
        access: uniformAccess('own', false),
      }),
    ).rejects.toThrow('settings access');
    await expect(
      as.admin.mutation(api.features.users.mutations.setEmployeeRole, {
        userId: sam.userId,
        role: 'nope',
      }),
    ).rejects.toThrow('invalid_role');
    // A settings-holding custom role cannot strip settings from itself.
    const chief = await as.admin.mutation(api.features.roles.mutations.createRole, {
      label: 'Chef',
      access: uniformAccess('all', true),
    });
    const chiefUser = await seedEmployee(t, { email: 'chef@example.com', role: chief });
    await expect(
      asIdentity(t, chiefUser.identity).mutation(api.features.roles.mutations.updateRole, {
        key: chief,
        access: uniformAccess('all', false),
      }),
    ).rejects.toThrow('role_lock_out');

    // Delete with replacement moves the users and is audited on each.
    await as.admin.mutation(api.features.roles.mutations.deleteRole, {
      key,
      replacementKey: 'member',
    });
    expect((await t.run((ctx) => ctx.db.get(sam.userId)))?.role).toBe('member');
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'employee').eq('entityId', sam.userId))
        .collect(),
    );
    expect(audit.at(-1)?.metadata).toEqual({ changes: { role: { old: key, new: 'member' } } });
    expect(
      (await as.admin.query(api.features.roles.queries.listRoles, {})).some((r) => r.key === key),
    ).toBe(false);
  });

  test('warnings', () => {
    const roles = [
      { key: 'a', access: uniformAccess('none', false) },
      { key: 'b', access: uniformAccess('team', true) },
    ];
    expect(
      accessWarnings(roles, { callerRoleKey: 'b', rolesWithoutTeamMembers: new Set(['b']) }).map(
        (w) => w.code,
      ),
    ).toEqual(['no_records', 'team_without_team']);
    expect(
      accessWarnings([{ key: 'b', access: uniformAccess('all', false) }], { callerRoleKey: 'b' }),
    ).toEqual([{ code: 'own_settings_lost', roleKey: 'b' }]);
  });
});

describe('access levels', () => {
  test('the ladder: member = own + pool, manager = team + pool, admin = all', async () => {
    const { as, leads } = await setup();
    const all = Object.values(leads).sort();
    expect(await listLeadIds(as.admin)).toEqual(all);
    expect(await listLeadIds(as.marc)).toEqual([leads.nina, leads.shared, leads.pool].sort());
    expect(await listLeadIds(as.nina)).toEqual([leads.nina, leads.shared, leads.pool].sort());
    expect(await listLeadIds(as.sam)).toEqual([leads.sam, leads.shared, leads.pool].sort());
    // Sam cannot touch Nina's lead; can claim the pool.
    await expect(
      as.sam.mutation(api.features.crm.mutations.updateLead, { leadId: leads.nina, comment: 'x' }),
    ).rejects.toThrow('lead_not_found');
    await as.sam.mutation(api.features.crm.mutations.updateLead, {
      leadId: leads.pool,
      ownerIds: [(await as.sam.query(api.auth.getCurrentUser, {}))!._id as Id<'users'>],
    });
    expect(await listLeadIds(as.nina)).toEqual([leads.nina, leads.shared].sort());
  });

  test('a cell change applies on the next request; none hides the module', async () => {
    const { as, leads, sam } = await setup();
    // Members see every lead once the cell says so…
    await as.admin.mutation(api.features.roles.mutations.updateRole, {
      key: 'member',
      access: { ...uniformAccess('own', false), leads: 'all' },
    });
    expect(await listLeadIds(as.sam)).toEqual(Object.values(leads).sort());
    // …and nothing at all at `none`: reads empty, writes refused, counts zero.
    await as.admin.mutation(api.features.roles.mutations.updateRole, {
      key: 'member',
      access: { ...uniformAccess('own', false), leads: 'none' },
    });
    expect(await listLeadIds(as.sam)).toEqual([]);
    expect(
      await as.sam.query(api.features.crm.queries.getLeadDetail, { leadId: leads.sam }),
    ).toBeNull();
    expect(
      (await as.sam.query(api.features.crm.queries.countLeadsByLifecycleStage, {})).total,
    ).toBe(0);
    await expect(
      as.sam.mutation(api.features.crm.mutations.createLead, {
        firstName: 'X',
        lastName: 'Y',
        ownerIds: [sam.userId],
      }),
    ).rejects.toThrow();
  });

  test('every module follows its owner; child rows follow their parent', async () => {
    const { t, as, sam, nina, leads } = await setup();
    await as.admin.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const samDeal = await as.admin.mutation(api.features.deals.mutations.createDeal, {
      title: 'Sam deal',
      ownerIds: [sam.userId],
      leadId: leads.sam,
    });
    const ninaDeal = await as.admin.mutation(api.features.deals.mutations.createDeal, {
      title: 'Nina deal',
      ownerIds: [nina.userId],
    });
    const samCo = await as.admin.mutation(api.features.companies.mutations.createCompany, {
      name: 'Sam & Co',
      ownerIds: [sam.userId],
    });
    const poolCo = await as.admin.mutation(api.features.companies.mutations.createCompany, {
      name: 'Public SA',
    });
    // Campaigns and workflows follow their creator.
    const samCampaign = await t.run((ctx) =>
      ctx.db.insert('campaigns', {
        name: 'Sam news',
        status: 'draft',
        channel: 'email',
        totalCount: 0,
        sentCount: 0,
        failedCount: 0,
        createdBy: sam.userId,
        updatedAt: Date.now(),
      }),
    );
    const ninaWorkflow = await as.nina.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Nina flow',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'create_task', title: 'T' }],
      startNodeId: 'n1',
    });
    // A note on Sam's lead follows the lead.
    await as.sam.mutation(api.features.crm.mutations.createNote, {
      leadId: leads.sam,
      content: 'n',
    });

    const dealIds = (who: ReturnType<typeof asIdentity>) =>
      who
        .query(api.features.deals.queries.listDealsPaginated, {
          paginationOpts: { numItems: 10, cursor: null },
        })
        .then((r) => r.page.map((d) => d._id).sort());
    expect(await dealIds(as.sam)).toEqual([samDeal]);
    expect(await dealIds(as.marc)).toEqual([ninaDeal]);
    expect(await dealIds(as.admin)).toEqual([samDeal, ninaDeal].sort());

    const companyIds = (who: ReturnType<typeof asIdentity>) =>
      who
        .query(api.features.companies.queries.listCompaniesPaginated, {
          paginationOpts: { numItems: 10, cursor: null },
        })
        .then((r) => r.page.map((c) => c._id).sort());
    expect(await companyIds(as.sam)).toEqual([samCo, poolCo].sort());
    expect(await companyIds(as.nina)).toEqual([poolCo]);
    expect((await as.nina.query(api.features.companies.queries.countCompanies, {})).total).toBe(1);
    expect((await as.sam.query(api.features.companies.queries.countCompanies, {})).total).toBe(2);

    const campaigns = await as.nina.query(api.features.crm.queries.listCampaigns, {});
    expect(campaigns.map((c) => c._id)).toEqual([]);
    expect(
      (await as.sam.query(api.features.crm.queries.listCampaigns, {})).map((c) => c._id),
    ).toEqual([samCampaign]);
    const workflows = await as.marc.query(api.features.workflows.queries.listWorkflows, {});
    expect(workflows.map((w) => w._id)).toEqual([ninaWorkflow]);
    expect((await as.sam.query(api.features.workflows.queries.listWorkflows, {})).length).toBe(0);

    expect(
      await as.nina.query(api.features.crm.queries.listLeadNotes, { leadId: leads.sam }),
    ).toEqual([]);
    expect(
      (await as.sam.query(api.features.crm.queries.listLeadNotes, { leadId: leads.sam })).length,
    ).toBe(1);

    // Scoped pipeline stats sum the per-owner aggregates.
    const pipelines = await as.admin.query(api.features.deals.queries.listPipelines, {});
    const stats = await as.marc.query(api.features.deals.queries.getPipelineStats, {
      pipelineId: pipelines[0]._id,
    });
    expect(stats?.open.count).toBe(1);
    const adminStats = await as.admin.query(api.features.deals.queries.getPipelineStats, {
      pipelineId: pipelines[0]._id,
    });
    expect(adminStats?.open.count).toBe(2);
  });

  test('tasks: owner, team, neither; « Mon équipe » buckets', async () => {
    const { as, nord, sud, sam, nina } = await setup();
    const now = Date.now();
    const b = {
      startOfToday: now - 60 * 60 * 1000,
      endOfToday: now + 60 * 60 * 1000,
      endOfWeek: now + 7 * 24 * 60 * 60 * 1000,
    };
    const create = (who: ReturnType<typeof asIdentity>, args: Record<string, unknown>) =>
      who.mutation(api.features.activities.mutations.createActivity, {
        type: 'task',
        title: 'T',
        dueAt: now,
        ...args,
      } as never);
    const nordTask = await create(as.admin, { teamId: nord, ownerId: null });
    const sudTask = await create(as.admin, { teamId: sud, ownerId: null });
    const ninaTask = await create(as.admin, { ownerId: nina.userId });
    const freeTask = await create(as.admin, { ownerId: null });
    const samTask = await create(as.sam, {});

    // Team-assigned task: every Nord member sees it, Sud does not.
    const teamList = (who: ReturnType<typeof asIdentity>, teamId: Id<'teams'>) =>
      who
        .query(api.features.activities.queries.listTasks, {
          teamId,
          dueFrom: b.startOfToday,
          dueBefore: b.endOfToday,
          paginationOpts: { numItems: 10, cursor: null },
        })
        .then((r) => r.page.map((a) => a._id));
    expect(await teamList(as.nina, nord)).toEqual([nordTask]);
    expect(await teamList(as.marc, nord)).toEqual([nordTask]);
    expect(await teamList(as.sam, nord)).toEqual([]);
    expect(await teamList(as.sam, sud)).toEqual([sudTask]);
    expect(
      (
        await as.nina.query(api.features.activities.queries.countTaskBuckets, {
          teamId: nord,
          ...b,
        })
      ).today,
    ).toBe(1);

    // Visibility rule through the RLS reader: Marc (team level) sees Nina's
    // task; Sam does not; the free task is visible to everyone.
    const get = (who: ReturnType<typeof asIdentity>, id: Id<'activities'>) =>
      who.query(api.features.activities.queries.getActivity, { activityId: id });
    expect((await get(as.marc, ninaTask))?._id).toBe(ninaTask);
    expect(await get(as.sam, ninaTask)).toBeNull();
    expect((await get(as.sam, freeTask))?._id).toBe(freeTask);
    expect((await get(as.nina, freeTask))?._id).toBe(freeTask);
    expect((await get(as.nina, samTask)) ?? null).toBeNull();
    expect((await get(as.sam, samTask))?._id).toBe(samTask);
    void sam;
  });

  test('a campaign only reaches the leads its creator can see', async () => {
    const { t, as, leads } = await setup();
    const resolved = await as.sam.query(api.features.crm.queries.listMatchingLeadIds, {});
    expect(resolved.leadIds.sort()).toEqual([leads.sam, leads.shared, leads.pool].sort());
    void t;
  });
});
