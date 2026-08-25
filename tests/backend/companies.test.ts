import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { SIRET_SCHEME, registrationSchemeFor } from '../../convex/_lib/validators/companyRegistry';
import {
  companyDomainOfEmail,
  isFreeMailDomain,
  normalizeDomain,
} from '../../convex/lib/companyDomains';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

// Valid Luhn SIRET/SIREN samples (INSEE's own: 732 829 320 = Google France SIREN).
const SIREN = '732829320';
const SIRET = '73282932000074';

async function leadOf(t: T, leadId: Id<'leads'>) {
  return (await t.run((ctx) => ctx.db.get(leadId)))!;
}

describe('registration schemes (pure)', () => {
  test('France validates SIREN/SIRET with the Luhn key; other countries are free text', () => {
    expect(registrationSchemeFor('FR')).toBe(SIRET_SCHEME);
    expect(SIRET_SCHEME.normalize('732 829 320 00074')).toBe(SIRET);
    expect(SIRET_SCHEME.validate(SIRET)).toBeNull();
    expect(SIRET_SCHEME.validate(SIREN)).toBeNull();
    expect(SIRET_SCHEME.validate('73282932000075')).toMatch(/clé de contrôle/);
    expect(SIRET_SCHEME.validate('1234')).toMatch(/9 chiffres/);
    // La Poste exception: digit sum multiple of 5.
    expect(SIRET_SCHEME.validate('35600000000001')).toBeNull();

    const de = registrationSchemeFor('DE');
    expect(de.id).toBe('generic');
    expect(de.validate(de.normalize('  HRB 12345 '))).toBeNull();
  });

  test('domain helpers normalize and exclude consumer mailboxes', () => {
    expect(normalizeDomain('https://www.Acme.fr/contact')).toBe('acme.fr');
    expect(normalizeDomain('not a domain')).toBeUndefined();
    expect(isFreeMailDomain('gmail.com')).toBe(true);
    expect(isFreeMailDomain('yahoo.co.uk')).toBe(true);
    expect(isFreeMailDomain('acme.fr')).toBe(false);
    expect(companyDomainOfEmail('jean@Orange.fr')).toBeUndefined();
    expect(companyDomainOfEmail('jean@example.com')).toBeUndefined();
    expect(companyDomainOfEmail('jean@acme.test')).toBeUndefined();
    expect(companyDomainOfEmail('jean@acme.fr')).toBe('acme.fr');
  });
});

describe('company mutations', () => {
  test('create normalizes identifiers, audits, and enforces uniqueness', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: '  Acme  ',
      country: 'fr',
      registrationNumber: '732 829 320 00074',
      domain: 'https://www.acme.fr/',
    });
    const company = (await t.run((ctx) => ctx.db.get(companyId)))!;
    expect(company).toMatchObject({
      name: 'Acme',
      country: 'FR',
      registrationNumber: SIRET,
      domain: 'acme.fr',
    });
    expect(company.searchText).toContain('acme');

    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'company').eq('entityId', companyId))
        .collect(),
    );
    expect(audit.map((a) => a.action)).toEqual(['create']);

    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Acme bis',
        registrationNumber: SIRET,
      }),
    ).rejects.toThrow('company_registration_exists');
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Acme ter',
        domain: 'acme.fr',
      }),
    ).rejects.toThrow('company_domain_exists');
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Bad',
        country: 'FR',
        registrationNumber: '12345',
      }),
    ).rejects.toThrow('invalid_registration_number');
    // The same digits are fine for a country without a scheme.
    await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Bad GmbH',
      country: 'DE',
      registrationNumber: '12345',
    });
  });

  test('the total count follows creations and deletions (aggregate)', async () => {
    const { as } = await setup();
    const a = await as.mutation(api.features.companies.mutations.createCompany, { name: 'A' });
    await as.mutation(api.features.companies.mutations.createCompany, { name: 'B' });
    expect((await as.query(api.features.companies.queries.countCompanies, {})).total).toBe(2);
    await as.mutation(api.features.companies.mutations.deleteCompany, { companyId: a });
    expect((await as.query(api.features.companies.queries.countCompanies, {})).total).toBe(1);
  });
});

describe('automatic lead ↔ company matching', () => {
  test('a lead with a business email attaches to the existing domain company', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      domain: 'acme.fr',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@ACME.fr',
    });
    expect((await leadOf(t, leadId)).companyId).toBe(companyId);

    const company = await as.query(api.features.companies.queries.getCompany, { companyId });
    expect(company?.contactCount).toBe(1);
    // The company name is folded into the lead's search text.
    const found = await as.query(api.features.crm.queries.listLeadsPaginated, {
      search: 'acme',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(found.page.map((l) => l._id)).toEqual([leadId]);
    expect(found.page[0].companyName).toBe('Acme');
  });

  test('an unknown business domain creates the company; free mail creates nothing', async () => {
    const { t, as } = await setup();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@newco.io',
    });
    const lead = await leadOf(t, leadId);
    expect(lead.companyId).toBeDefined();
    const company = (await t.run((ctx) => ctx.db.get(lead.companyId!)))!;
    expect(company).toMatchObject({
      name: 'newco.io',
      domain: 'newco.io',
      website: 'https://newco.io',
    });

    const gmailLead = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'B',
      lastName: 'B',
      email: 'b@gmail.com',
    });
    expect((await leadOf(t, gmailLead)).companyId).toBeUndefined();
    expect((await as.query(api.features.companies.queries.countCompanies, {})).total).toBe(1);
  });

  test('an explicit company wins; a new business email on a company-less lead matches', async () => {
    const { t, as } = await setup();
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      domain: 'acme.fr',
    });
    const other = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Other',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@acme.fr',
      companyId: other,
    });
    expect((await leadOf(t, leadId)).companyId).toBe(other);

    // Detach, then change the email: the domain match kicks in again.
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, companyId: null });
    expect((await leadOf(t, leadId)).companyId).toBeUndefined();
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, email: 'a2@acme.fr' });
    expect((await leadOf(t, leadId)).companyId).toBe(acme);
  });

  test('CSV import attaches by registration number, then domain, else creates from the name', async () => {
    const { t, as } = await setup();
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      country: 'FR',
      registrationNumber: SIRET,
      domain: 'acme.fr',
    });
    const res = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        // SIRET match (spaces tolerated), email on another domain.
        {
          firstName: 'A',
          lastName: 'A',
          email: 'a@personal.example',
          company: { registrationNumber: '732 829 320 00074' },
        },
        // Domain match from the email.
        { firstName: 'B', lastName: 'B', email: 'b@acme.fr' },
        // Named company, unknown → created once for both rows (chunk cache).
        { firstName: 'C', lastName: 'C', email: 'c@globex.com', company: { name: 'Globex' } },
        { firstName: 'D', lastName: 'D', email: 'd@globex.com', company: { name: 'Globex' } },
        // Invalid SIRET for FR → row error.
        {
          firstName: 'E',
          lastName: 'E',
          email: 'e@x.example',
          company: { registrationNumber: '123' },
        },
      ],
    });
    expect(res.created).toBe(4);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].error).toContain('invalid_registration_number');

    const byEmail = async (email: string) =>
      (await t.run((ctx) =>
        ctx.db
          .query('leads')
          .withIndex('by_email', (q) => q.eq('email', email))
          .first(),
      ))!;
    expect((await byEmail('a@personal.example')).companyId).toBe(acme);
    expect((await byEmail('b@acme.fr')).companyId).toBe(acme);
    const c = await byEmail('c@globex.com');
    const d = await byEmail('d@globex.com');
    expect(c.companyId).toBeDefined();
    expect(d.companyId).toBe(c.companyId);
    const globex = (await t.run((ctx) => ctx.db.get(c.companyId!)))!;
    expect(globex).toMatchObject({ name: 'Globex', domain: 'globex.com' });
    expect((await as.query(api.features.companies.queries.countCompanies, {})).total).toBe(2);
  });
});

describe('company lifecycle side effects', () => {
  test('renaming re-stamps its leads’ search text', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      domain: 'acme.fr',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@acme.fr',
    });
    await as.mutation(api.features.companies.mutations.updateCompany, {
      companyId,
      name: 'Initech',
    });
    // The scheduler is never advanced in tests: drive the batch by hand.
    await t.mutation(internal.features.companies.internal.restampCompanyLeadsSearchText, {
      companyId,
    });
    expect((await leadOf(t, leadId)).searchText).toContain('initech');
  });

  test('deleting a company detaches its leads and hides it from the picker', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      domain: 'acme.fr',
    });
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@acme.fr',
    });
    await as.mutation(api.features.companies.mutations.deleteCompany, { companyId });
    await t.mutation(internal.features.companies.internal.detachCompanyLeads, { companyId });
    expect((await leadOf(t, leadId)).companyId).toBeUndefined();
    expect(await as.query(api.features.companies.queries.getCompany, { companyId })).toBeNull();
    expect(
      await as.query(api.features.companies.queries.searchCompanies, { search: 'acme' }),
    ).toEqual([]);
    // A deleted company frees its domain for a new one.
    await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme 2',
      domain: 'acme.fr',
    });
  });

  test('listLeadsPaginated filters a company’s contacts through the by_company index', async () => {
    const { as } = await setup();
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      domain: 'acme.fr',
    });
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@acme.fr',
    });
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'B',
      lastName: 'B',
      email: 'b@gmail.com',
    });
    const page = await as.query(api.features.crm.queries.listLeadsPaginated, {
      companyIds: [acme],
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page.map((l) => l.firstName)).toEqual(['A']);
  });

  test('backfillLeadCompanies attaches legacy company-less leads by domain', async () => {
    const { t, emp, as } = await setup();
    await seedLead(t, { email: 'x@legacy-corp.io' });
    await seedLead(t, { email: 'y@legacy-corp.io' });
    await seedLead(t, { email: 'z@hotmail.fr' });
    const res = await t.mutation(internal.features.companies.internal.backfillLeadCompanies, {
      userId: emp.userId,
    });
    expect(res).toMatchObject({ seen: 3, attached: 2, isDone: true });
    expect((await as.query(api.features.companies.queries.countCompanies, {})).total).toBe(1);
  });
});
