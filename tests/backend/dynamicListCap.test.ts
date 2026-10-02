import { expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedConfig, seedEmployee } from './helpers';

const criteria = {
  combinator: 'and' as const,
  groups: [
    {
      combinator: 'and' as const,
      rules: [
        {
          field: { kind: 'standard' as const, field: 'lifecycleStage' as const },
          operator: 'equals' as const,
          value: 'customer',
        },
      ],
    },
  ],
};

test('the cap of dynamic lists is the deployment’s: lists a member cannot see count against it', async () => {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t, { lists: { maxDynamicLists: 1 } });
  const create = (who: typeof admin, name: string) =>
    asIdentity(t, who.identity).mutation(api.features.leadLists.mutations.createLeadList, {
      name,
      kind: 'dynamic',
      criteria,
    });
  const limits = (who: typeof admin) =>
    asIdentity(t, who.identity).query(api.features.leadLists.queries.getListLimits, {});

  await create(admin, 'Clients');
  // The member does not see the list of the admin; it fills the cap all the same.
  expect(
    await asIdentity(t, member.identity).query(api.features.leadLists.queries.listLeadLists, {}),
  ).toEqual([]);
  expect(await limits(member)).toEqual({ maxDynamicLists: 1, dynamicCount: 1 });
  expect(await limits(admin)).toEqual({ maxDynamicLists: 1, dynamicCount: 1 });
  await expect(create(member, 'Les miens')).rejects.toMatchObject({
    data: { code: 'dynamic_list_cap_reached' },
  });
  // A static list is not counted.
  await asIdentity(t, member.identity).mutation(api.features.leadLists.mutations.createLeadList, {
    name: 'Salon',
  });
  expect(await limits(member)).toEqual({ maxDynamicLists: 1, dynamicCount: 1 });
});
