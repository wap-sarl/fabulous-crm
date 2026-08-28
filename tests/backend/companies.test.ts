import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { SIRET_SCHEME, registrationSchemeFor } from '../../convex/_lib/validators/companyRegistry';
import {
  companyDomainOfEmail,
  isFreeMailDomain,
  normalizeDomain,
} from '../../convex/lib/companyDomains';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

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

describe('lead ↔ company matching', () => {
  test('the form is offered the domain company and attaches only on an explicit pick', async () => {
    const { t, as } = await setup();
    const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Initech',
      domain: 'acme.fr',
    });
    // The prompt's query names the company…
    expect(
      await as.query(api.features.companies.queries.findCompanyByEmailDomain, {
        email: 'jean@ACME.fr',
      }),
    ).toEqual({ _id: companyId, name: 'Initech', domain: 'acme.fr' });
    // …but nothing is attached without its answer.
    const detached = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean@ACME.fr',
    });
    expect((await leadOf(t, detached)).companyId).toBeUndefined();
    // « Oui » sends the company id.
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean2@ACME.fr',
      companyId,
    });
    expect((await leadOf(t, leadId)).companyId).toBe(companyId);

    const company = await as.query(api.features.companies.queries.getCompany, { companyId });
    expect(company?.contactCount).toBe(1);
    // The company name is folded into the attached lead's search text only.
    const found = await as.query(api.features.crm.queries.listLeadsPaginated, {
      search: 'initech',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(found.page.map((l) => l._id)).toEqual([leadId]);
    expect(found.page[0].companyName).toBe('Initech');
  });

  test('an unknown business domain or a consumer mailbox proposes nothing', async () => {
    const { t, as } = await setup();
    const find = (email: string) =>
      as.query(api.features.companies.queries.findCompanyByEmailDomain, { email });
    expect(await find('a@newco.io')).toBeNull();
    expect(await find('b@gmail.com')).toBeNull();
    expect(await find('not-an-email')).toBeNull();
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'A',
      lastName: 'A',
      email: 'a@newco.io',
    });
    expect((await leadOf(t, leadId)).companyId).toBeUndefined();
    expect((await as.query(api.features.companies.queries.countCompanies, {})).total).toBe(0);

    // Once the company exists, the same domain is proposed; gmail still isn't.
    const newco = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Newco',
      domain: 'newco.io',
    });
    expect((await find('c@newco.io'))?._id).toBe(newco);
    expect(await find('b@gmail.com')).toBeNull();
  });

  test('a new business email on a company-less lead never attaches by itself', async () => {
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

    // Detach, then change the email: still detached until the form's « Oui ».
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, companyId: null });
    expect((await leadOf(t, leadId)).companyId).toBeUndefined();
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, email: 'a2@acme.fr' });
    expect((await leadOf(t, leadId)).companyId).toBeUndefined();
    await as.mutation(api.features.crm.mutations.updateLead, { leadId, companyId: acme });
    expect((await leadOf(t, leadId)).companyId).toBe(acme);
  });

  test('a soft-deleted company sharing the identifiers does not hide the live one', async () => {
    const { t, as } = await setup();
    const dead = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme (old)',
      country: 'FR',
      registrationNumber: SIRET,
      vatNumber: 'FR40303265045',
      domain: 'acme.fr',
    });
    await as.mutation(api.features.companies.mutations.deleteCompany, { companyId: dead });
    // The identifiers are free again for a new company…
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      country: 'FR',
      registrationNumber: SIRET,
      vatNumber: 'FR40303265045',
      domain: 'acme.fr',
    });
    // …and every lookup lands on the live row, not the older deleted one.
    expect(
      (
        await as.query(api.features.companies.queries.findCompanyByEmailDomain, {
          email: 'jean@acme.fr',
        })
      )?._id,
    ).toBe(acme);
    const res = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        { firstName: 'A', lastName: 'A', email: 'a@acme.fr' },
        {
          firstName: 'B',
          lastName: 'B',
          email: 'b@gmail.com',
          company: { registrationNumber: SIRET },
        },
        {
          firstName: 'C',
          lastName: 'C',
          email: 'c@gmail.com',
          company: { vatNumber: 'FR40303265045' },
        },
      ],
    });
    expect(res.errors).toEqual([]);
    const leads = await t.run((ctx) => ctx.db.query('leads').collect());
    expect(leads.map((l) => l.companyId)).toEqual([acme, acme, acme]);
    // Uniqueness among live companies is enforced past the deleted row.
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Acme ter',
        domain: 'acme.fr',
      }),
    ).rejects.toThrow('company_domain_exists');
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Acme ter',
        country: 'FR',
        registrationNumber: SIRET,
      }),
    ).rejects.toThrow('company_registration_exists');
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
      companyId,
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
      companyId,
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
      companyId: acme,
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
});

describe('VAT numbers', () => {
  test('the scheme validates format + checksum for the company country', async () => {
    const { vatSchemeFor } = await import('../../convex/_lib/validators/companyRegistry');
    const fr = vatSchemeFor('FR');
    expect(fr.label).toBe('N° de TVA intracommunautaire');
    expect(fr.normalize('fr 40 303 265 045')).toBe('FR40303265045');
    expect(fr.validate('FR40303265045', 'FR')).toBeNull();
    expect(fr.validate('FR40303265046', 'FR')).toMatch(/clé de contrôle/);
    // A Belgian number on a French company is refused.
    expect(fr.validate('BE0411905847', 'FR')).toMatch(/pour ce pays/);
    expect(fr.lookup).toBe(true);
    // Switzerland: jsvat checksum, no VIES.
    const ch = vatSchemeFor('CH');
    expect(ch.validate(ch.normalize('CHE-123.456.788 MWST'), 'CH')).toBeNull();
    expect(ch.lookup).toBe(false);
    // Unknown country: free text.
    expect(vatSchemeFor('MA').validate('123456', 'MA')).toBeNull();
  });

  test('companies store the normalized number, enforce uniqueness, and match on it', async () => {
    const { t, as } = await setup();
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme',
      country: 'FR',
      vatNumber: 'fr 40 303 265 045',
    });
    expect((await t.run((ctx) => ctx.db.get(acme)))?.vatNumber).toBe('FR40303265045');
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Copy',
        country: 'FR',
        vatNumber: 'FR40303265045',
      }),
    ).rejects.toThrow('company_vat_exists');
    await expect(
      as.mutation(api.features.companies.mutations.createCompany, {
        name: 'Bad',
        country: 'FR',
        vatNumber: 'FR12',
      }),
    ).rejects.toThrow('invalid_vat_number');

    const res = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        {
          firstName: 'A',
          lastName: 'A',
          email: 'a@gmail.com',
          company: { vatNumber: 'FR40303265045' },
        },
      ],
    });
    expect(res.created).toBe(1);
    const lead = await t.run((ctx) =>
      ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', 'a@gmail.com'))
        .first(),
    );
    expect(lead?.companyId).toBe(acme);
  });
});
