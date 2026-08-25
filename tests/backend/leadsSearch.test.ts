import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

async function searchLeads(as: ReturnType<typeof asIdentity>, search: string, extra = {}) {
  const res = await as.query(api.features.crm.queries.listLeadsPaginated, {
    search,
    ...extra,
    paginationOpts: { numItems: 10, cursor: null },
  });
  return res.page;
}

describe('lead search (by_searchText index)', () => {
  test('is accent-insensitive: "helene" finds Hélène', async () => {
    const { as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Hélène',
      lastName: 'Lefèvre',
      email: 'helene@example.com',
    });
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Marc',
      lastName: 'Durand',
      email: 'marc@example.com',
    });

    const page = await searchLeads(as, 'helene');
    expect(page.map((l) => l._id)).toEqual([leadId]);
    // Accented query, unaccented data direction too.
    expect((await searchLeads(as, 'lefèvre')).map((l) => l._id)).toEqual([leadId]);
  });

  test('matches word prefixes and email fragments', async () => {
    const { as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Marie',
      lastName: 'Curie',
      email: 'marie.curie@radium.fr',
    });

    expect((await searchLeads(as, 'mar')).map((l) => l._id)).toEqual([leadId]);
    // Punctuation-split email: the domain is its own token.
    expect((await searchLeads(as, 'radium')).map((l) => l._id)).toEqual([leadId]);
  });

  test('searchText follows identity updates', async () => {
    const { as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ancien',
      lastName: 'Nom',
      email: 'a@example.com',
    });
    await as.mutation(api.features.crm.mutations.updateLead, {
      leadId,
      lastName: 'Nouveau',
    });

    expect((await searchLeads(as, 'nouveau')).map((l) => l._id)).toEqual([leadId]);
    expect(await searchLeads(as, 'nom')).toHaveLength(0);
  });

  test('other filters stay residual on the search path', async () => {
    const { as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Paul',
      lastName: 'Test',
      email: 'p1@example.com',
    });
    const converted = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Paul',
      lastName: 'Test',
      email: 'p2@example.com',
      lifecycleStage: 'customer',
    });

    const page = await searchLeads(as, 'paul', { lifecycleStages: ['customer'] });
    expect(page.map((l) => l._id)).toEqual([converted]);
  });

  test('the campaign-filter substring match is accent-insensitive too', async () => {
    const { as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Hélène',
      lastName: 'Lefèvre',
      email: 'helene@example.com',
    });

    const result = await as.query(api.features.crm.queries.listMatchingLeadIds, {
      search: 'helene',
    });
    expect(result.leadIds).toEqual([leadId]);
  });
});
