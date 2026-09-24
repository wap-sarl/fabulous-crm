import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { IMPORT_BATCH_SIZE } from '../../convex/_lib/validators/imports';
import { setExtensionsForTests } from '../../convex/extensions';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

const NOW = Date.parse('2026-09-25T09:00:00Z');
const opened: T[] = [];
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});
afterEach(async () => {
  setExtensionsForTests(null);
  for (const t of opened.splice(0)) await settle(t);
  jest.useRealTimers();
});

/** Runs the scheduled batches; the fake clock lands on the real time afterwards, so it goes back for the seeded sessions. */
async function settle(t: T) {
  await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  jest.setSystemTime(new Date(NOW));
}

async function setup() {
  const t = createTestConvex();
  opened.push(t);
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, admin.identity);
  await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
  return { t, as, admin };
}

type As = Awaited<ReturnType<typeof setup>>['as'];
type Row = { data?: Record<string, unknown>; error?: string; raw?: string[] };

/** A job with its rows uploaded, as the SPA does it. */
async function upload(
  as: As,
  entity: 'lead' | 'company' | 'deal' | 'activity',
  rows: Row[],
  extra: { listId?: Id<'leadLists'>; headers?: string[] } = {},
): Promise<Id<'importJobs'>> {
  const headers = extra.headers ?? ['a', 'b'];
  const jobId = await as.mutation(api.features.imports.mutations.createJob, {
    entity,
    fileName: 'fichier.csv',
    headers,
    targets: headers.map(() => null),
    listId: extra.listId,
    totalRows: rows.length,
  });
  for (let start = 0; start < rows.length; start += 500) {
    await as.mutation(api.features.imports.mutations.appendRows, {
      jobId,
      rows: rows.slice(start, start + 500).map((row, i) => ({
        index: start + i,
        line: start + i + 2,
        raw: row.raw ?? ['x', 'y'],
        // biome-ignore lint/suspicious/noExplicitAny: test rows of every entity
        data: row.data as any,
        error: row.error,
      })),
    });
  }
  return jobId;
}

const job = (t: T, jobId: Id<'importJobs'>) => t.run((ctx) => ctx.db.get(jobId));
const rowsOf = (t: T, jobId: Id<'importJobs'>) =>
  t.run((ctx) =>
    ctx.db
      .query('importRows')
      .withIndex('by_job_index', (q) => q.eq('jobId', jobId))
      .collect(),
  );

async function simulate(t: T, as: As, jobId: Id<'importJobs'>) {
  await as.mutation(api.features.imports.mutations.simulateJob, { jobId });
  await settle(t);
  return (await job(t, jobId))!;
}
async function launch(
  t: T,
  as: As,
  jobId: Id<'importJobs'>,
  duplicatePolicy?: 'update' | 'create',
) {
  await as.mutation(api.features.imports.mutations.launchJob, { jobId, duplicatePolicy });
  await settle(t);
  return (await job(t, jobId))!;
}

describe('advanced import', () => {
  test('mappings: saved per entity, listed newest first, renamed, deleted', async () => {
    const { as } = await setup();
    const first = await as.mutation(api.features.imports.mutations.saveMapping, {
      entity: 'lead',
      name: 'Export HubSpot',
      headers: ['First Name', 'Last Name', 'Email'],
      targets: ['firstname', 'lastname', 'email'],
    });
    jest.setSystemTime(new Date(NOW + 1000));
    await as.mutation(api.features.imports.mutations.saveMapping, {
      entity: 'company',
      name: 'Sociétés',
      headers: ['Nom'],
      targets: ['name'],
    });
    const second = await as.mutation(api.features.imports.mutations.saveMapping, {
      entity: 'lead',
      name: 'Excel',
      headers: ['Prénom', 'Nom'],
      targets: ['firstname', 'lastname'],
    });
    const leads = await as.query(api.features.imports.queries.listMappings, { entity: 'lead' });
    expect(leads.map((m) => m.name)).toEqual(['Excel', 'Export HubSpot']);
    expect(leads[1]).toMatchObject({ targets: ['firstname', 'lastname', 'email'] });
    await as.mutation(api.features.imports.mutations.saveMapping, {
      mappingId: first,
      entity: 'lead',
      name: 'HubSpot 2026',
      headers: ['First Name', 'Last Name', 'Email', 'Phone'],
      targets: ['firstname', 'lastname', 'email', 'phone'],
    });
    await as.mutation(api.features.imports.mutations.deleteMapping, { mappingId: second });
    const after = await as.query(api.features.imports.queries.listMappings, { entity: 'lead' });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      name: 'HubSpot 2026',
      headers: ['First Name', 'Last Name', 'Email', 'Phone'],
    });
    await expect(
      as.mutation(api.features.imports.mutations.saveMapping, {
        entity: 'lead',
        name: ' ',
        headers: ['a'],
        targets: [null],
      }),
    ).rejects.toThrow(/mapping_name_required/);
  });

  test('contacts: the dry run says what the run then does, row for row, and only the errors stay', async () => {
    const { t, as } = await setup();
    const known = await seedLead(t, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    // Through the mutation: the dedupe keys the duplicate search reads are stamped by the trigger.
    const twin = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'Marley',
      phone: '+33612345678',
    });
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, { name: 'Import' });
    const jobId = await upload(
      as,
      'lead',
      [
        { data: { firstName: 'New', lastName: 'Person', email: 'new@example.com' } },
        { data: { firstName: 'Ada', lastName: 'Byron', email: 'ADA@example.com', comment: 'MAJ' } },
        // Another email, the same phone: a probable duplicate of Bob.
        {
          data: {
            firstName: 'Bob',
            lastName: 'Marley',
            email: 'bob2@example.com',
            phone: '0612345678',
          },
        },
        {
          data: {
            firstName: 'Bad',
            lastName: 'Stage',
            email: 'bad@example.com',
            lifecycleStage: 'nope',
          },
        },
        { error: 'Prénom requis', raw: ['', 'Sans prénom'] },
      ],
      { listId },
    );

    const simulated = await simulate(t, as, jobId);
    expect(simulated.status).toBe('simulated');
    expect(simulated.counts).toEqual({ created: 1, updated: 1, duplicates: 1, errors: 2 });
    const verdicts = (await rowsOf(t, jobId)).sort((a, b) => a.index - b.index);
    expect(verdicts.map((r) => r.outcome)).toEqual([
      'create',
      'update',
      'duplicate',
      'error',
      'error',
    ]);
    expect(verdicts[1]).toMatchObject({
      matchId: known,
      matchLabel: 'Ada Lovelace (ada@example.com)',
    });
    expect(verdicts[2]).toMatchObject({ matchId: twin, reasons: ['phone', 'same_name'] });
    expect(verdicts[3]?.error).toBe('unknown_lifecycle_stage');
    // Nothing was written.
    expect((await t.run((ctx) => ctx.db.get(known)))?.lastName).toBe('Lovelace');
    expect(await t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(2);
    await expect(as.mutation(api.features.imports.mutations.launchJob, { jobId })).rejects.toThrow(
      /duplicate_policy_required/,
    );

    const done = await launch(t, as, jobId, 'update');
    expect(done.status).toBe('done');
    expect(done.simulated).toEqual(simulated.counts);
    expect(done.counts).toEqual({ created: 1, updated: 2, duplicates: 0, errors: 2 });
    const leads = await t.run((ctx) => ctx.db.query('leads').collect());
    expect(leads).toHaveLength(3);
    expect(await t.run((ctx) => ctx.db.get(known))).toMatchObject({
      lastName: 'Byron',
      comment: 'MAJ',
    });
    // The duplicate updated Bob and brought him the email he did not have.
    expect(await t.run((ctx) => ctx.db.get(twin))).toMatchObject({ email: 'bob2@example.com' });
    // The rows written are gone, the rows in error stay with the file's cells for the export.
    const left = await rowsOf(t, jobId);
    expect(left.map((r) => r.outcome)).toEqual(['error', 'error']);
    const errors = await as.query(api.features.imports.queries.errorRows, { jobId });
    expect(errors.rows.map((r) => r.error)).toEqual(['unknown_lifecycle_stage', 'Prénom requis']);
    expect(errors.rows[1]?.raw).toEqual(['', 'Sans prénom']);
    // Every contact written joined the list.
    const members = await t.run((ctx) => ctx.db.query('leadListMembers').collect());
    expect(members.filter((m) => m.listId === listId)).toHaveLength(3);
    const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    expect(audits.find((a) => a.entityType === 'importJob')?.metadata).toMatchObject({
      entity: 'lead',
      counts: done.counts,
    });
  });

  test('contacts: the policy « create anyway » creates the probable duplicate', async () => {
    const { t, as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'Marley',
      phone: '+33612345678',
    });
    const jobId = await upload(as, 'lead', [
      {
        data: {
          firstName: 'Bob',
          lastName: 'Marley',
          email: 'bob2@example.com',
          phone: '0612345678',
        },
      },
    ]);
    expect((await simulate(t, as, jobId)).counts.duplicates).toBe(1);
    const done = await launch(t, as, jobId, 'create');
    expect(done.counts).toEqual({ created: 1, updated: 0, duplicates: 0, errors: 0 });
    expect(await t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(2);
  });

  test('a batch that throws interrupts the job; the resume takes it up at that batch and creates no duplicate', async () => {
    const { t, as } = await setup();
    const total = IMPORT_BATCH_SIZE * 2 + 50;
    const rows = Array.from({ length: total }, (_, i) => ({
      data: { firstName: 'P', lastName: `N${i}`, email: `p${i}@example.com` },
    }));
    const jobId = await upload(as, 'lead', rows);
    expect((await simulate(t, as, jobId)).counts.created).toBe(total);
    // The second batch's gate refuses: the batch is rolled back whole, the first stays committed.
    let calls = 0;
    setExtensionsForTests({
      beforeLeadCreate: async () => {
        calls += 1;
        if (calls === 2) throw new Error('quota_exceeded');
      },
    });
    const interrupted = await launch(t, as, jobId);
    expect(interrupted).toMatchObject({
      status: 'interrupted',
      interruptedFrom: 'running',
      nextBatch: 1,
      error: 'quota_exceeded',
    });
    expect(interrupted.counts.created).toBe(IMPORT_BATCH_SIZE);
    expect(await t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(IMPORT_BATCH_SIZE);
    await expect(as.mutation(api.features.imports.mutations.launchJob, { jobId })).rejects.toThrow(
      /import_not_simulated/,
    );

    setExtensionsForTests(null);
    await as.mutation(api.features.imports.mutations.resumeJob, { jobId });
    await settle(t);
    const done = (await job(t, jobId))!;
    expect(done).toMatchObject({ status: 'done', nextBatch: 3 });
    expect(done.counts).toEqual({ created: total, updated: 0, duplicates: 0, errors: 0 });
    const emails = (await t.run((ctx) => ctx.db.query('leads').collect())).map((l) => l.email);
    expect(emails).toHaveLength(total);
    expect(new Set(emails).size).toBe(total);
    expect(await rowsOf(t, jobId)).toEqual([]);
  });

  test('cancel drops the rows; delete drops the report; a job is its owner’s unless settings', async () => {
    const { t, as } = await setup();
    const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
    const asMember = asIdentity(t, member.identity);
    const jobId = await upload(as, 'lead', [
      { data: { firstName: 'A', lastName: 'B', email: 'ab@example.com' } },
    ]);
    await expect(asMember.query(api.features.imports.queries.getJob, { jobId })).rejects.toThrow(
      /import_not_found/,
    );
    await as.mutation(api.features.imports.mutations.cancelJob, { jobId });
    await settle(t);
    expect((await job(t, jobId))?.status).toBe('cancelled');
    expect(await rowsOf(t, jobId)).toEqual([]);
    await as.mutation(api.features.imports.mutations.deleteJob, { jobId });
    await settle(t);
    expect(await job(t, jobId)).toBeNull();
    // A member sees only their own jobs.
    const own = await upload(asMember, 'lead', [
      { data: { firstName: 'C', lastName: 'D', email: 'cd@example.com' } },
    ]);
    expect(
      (await asMember.query(api.features.imports.queries.listJobs, {})).map((j) => j._id),
    ).toEqual([own]);
    expect((await as.query(api.features.imports.queries.listJobs, {})).map((j) => j._id)).toEqual([
      own,
    ]);
  });

  test('companies: matched by registration number, domain or exact name, else created; identifiers validated', async () => {
    const { t, as } = await setup();
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'ACME',
      country: 'FR',
      registrationNumber: '55210055400013',
      domain: 'acme.fr',
    });
    const jobId = await upload(as, 'company', [
      // Registration number in a looser form, a new name: an update of ACME.
      {
        data: {
          name: 'ACME SA',
          country: 'FR',
          registrationNumber: '552 100 554 00013',
          sector: 'Industrie',
        },
      },
      { data: { name: 'Globex', domain: 'globex.com', headcount: 120 } },
      // A number the country's scheme refuses is a row error (letters alone are dropped as no number).
      { data: { name: 'Initech', country: 'FR', registrationNumber: '123' } },
      { data: { name: '  ' } },
    ]);
    const simulated = await simulate(t, as, jobId);
    expect(simulated.counts).toEqual({ created: 1, updated: 1, duplicates: 0, errors: 2 });
    const done = await launch(t, as, jobId);
    expect(done.counts).toEqual({ created: 1, updated: 1, duplicates: 0, errors: 2 });
    expect(await t.run((ctx) => ctx.db.get(acme))).toMatchObject({
      name: 'ACME SA',
      sector: 'Industrie',
    });
    const companies = await t.run((ctx) => ctx.db.query('companies').collect());
    expect(companies.map((c) => c.name).sort()).toEqual(['ACME SA', 'Globex']);
    const errors = await as.query(api.features.imports.queries.errorRows, { jobId });
    expect(errors.rows.map((r) => r.error)).toEqual([
      expect.stringMatching(/invalid_registration_number/),
      'company_name_required',
    ]);

    // A second import of the same file: by name and by domain, nothing doubles.
    const again = await upload(as, 'company', [
      { data: { name: 'Globex', sector: 'Tech' } },
      { data: { name: 'ACME SA', domain: 'acme.fr', website: 'https://acme.fr' } },
    ]);
    await simulate(t, as, again);
    expect((await launch(t, as, again)).counts).toEqual({
      created: 0,
      updated: 2,
      duplicates: 0,
      errors: 0,
    });
    expect(await t.run((ctx) => ctx.db.query('companies').collect())).toHaveLength(2);
  });

  test('deals: pipeline and stage by label, contact by email, the same title of a contact updates', async () => {
    const { t, as } = await setup();
    const ada = await seedLead(t, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const jobId = await upload(as, 'deal', [
      {
        data: {
          title: 'Contrat Ada',
          amount: 1000,
          currency: 'eur',
          stage: 'Qualifiée',
          contactEmail: 'Ada@example.com',
          expectedCloseDate: '2026-12-31',
        },
      },
      { data: { title: 'Sans contact', amount: 50 } },
      { data: { title: 'Inconnu', contactEmail: 'nobody@example.com' } },
      { data: { title: 'Mauvaise étape', stage: 'Lune' } },
      { data: { title: 'Autre pipeline', pipeline: 'Inexistant' } },
    ]);
    expect((await simulate(t, as, jobId)).counts).toEqual({
      created: 2,
      updated: 0,
      duplicates: 0,
      errors: 3,
    });
    const done = await launch(t, as, jobId);
    expect(done.counts).toEqual({ created: 2, updated: 0, duplicates: 0, errors: 3 });
    const deals = await t.run((ctx) => ctx.db.query('deals').collect());
    const contract = deals.find((d) => d.title === 'Contrat Ada');
    expect(contract).toMatchObject({
      amount: 1000,
      currency: 'EUR',
      stageKey: 'qualified',
      leadId: ada,
      expectedCloseDate: '2026-12-31',
    });
    expect(deals.find((d) => d.title === 'Sans contact')?.stageKey).toBe('new');
    const errors = await as.query(api.features.imports.queries.errorRows, { jobId });
    expect(errors.rows.map((r) => r.error)).toEqual([
      'contact_not_found',
      'unknown_stage',
      'pipeline_not_found',
    ]);

    // The same file again: Ada's contract is updated and moved, the deal without a contact is created again.
    const again = await upload(as, 'deal', [
      {
        data: {
          title: 'contrat ada',
          amount: 1500,
          stage: 'Proposition envoyée',
          contactEmail: 'ada@example.com',
        },
      },
      { data: { title: 'Sans contact', amount: 50 } },
    ]);
    await simulate(t, as, again);
    expect((await launch(t, as, again)).counts).toEqual({
      created: 1,
      updated: 1,
      duplicates: 0,
      errors: 0,
    });
    expect(await t.run((ctx) => ctx.db.get(contract!._id))).toMatchObject({
      amount: 1500,
      stageKey: 'proposal',
    });
    expect(await t.run((ctx) => ctx.db.query('deals').collect())).toHaveLength(3);
  });

  test('activities: contact by email, company by name, the same title and date of a contact updates', async () => {
    const { t, as, admin } = await setup();
    const ada = await seedLead(t, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'ACME',
      country: 'FR',
    });
    const due = Date.parse('2026-10-01T09:00:00Z');
    const jobId = await upload(as, 'activity', [
      { data: { type: 'call', title: 'Rappeler', dueAt: due, contactEmail: 'ada@example.com' } },
      { data: { type: 'note', title: 'Visite', companyName: 'ACME', status: 'done' } },
      { data: { type: 'task', title: 'Perdu', contactEmail: 'nobody@example.com' } },
      { data: { type: 'task', title: 'Perdu aussi', companyName: 'Nulle part' } },
    ]);
    expect((await simulate(t, as, jobId)).counts).toEqual({
      created: 2,
      updated: 0,
      duplicates: 0,
      errors: 2,
    });
    expect((await launch(t, as, jobId)).counts).toEqual({
      created: 2,
      updated: 0,
      duplicates: 0,
      errors: 2,
    });
    const activities = await t.run((ctx) => ctx.db.query('activities').collect());
    expect(activities.find((a) => a.title === 'Rappeler')).toMatchObject({
      leadId: ada,
      dueAt: due,
      ownerId: admin.userId,
      status: 'open',
    });
    const visit = activities.find((a) => a.title === 'Visite');
    expect(visit).toMatchObject({ companyId: acme, status: 'done' });
    expect(visit?.completedAt).toBeDefined();

    const again = await upload(as, 'activity', [
      {
        data: {
          type: 'call',
          title: 'Rappeler',
          dueAt: due,
          contactEmail: 'ada@example.com',
          status: 'done',
          description: 'Fait',
        },
      },
    ]);
    await simulate(t, as, again);
    expect((await launch(t, as, again)).counts).toEqual({
      created: 0,
      updated: 1,
      duplicates: 0,
      errors: 0,
    });
    const call = await t.run((ctx) => ctx.db.query('activities').collect());
    expect(call).toHaveLength(2);
    expect(call.find((a) => a.title === 'Rappeler')).toMatchObject({
      status: 'done',
      description: 'Fait',
    });
  });

  test('a role without the module cannot open a job for it', async () => {
    const { t, as } = await setup();
    const support = await seedEmployee(t, { email: 'support@example.com' });
    const role = await as.mutation(api.features.roles.mutations.createRole, {
      label: 'Support',
      access: {
        leads: 'all',
        companies: 'none',
        deals: 'none',
        activities: 'all',
        campaigns: 'none',
        workflows: 'none',
        settings: false,
      },
    });
    await as.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: support.userId,
      role,
    });
    const asSupport = asIdentity(t, support.identity);
    await expect(upload(asSupport, 'company', [{ data: { name: 'X' } }])).rejects.toThrow(
      /Unauthorized: companies/,
    );
    await expect(
      upload(asSupport, 'lead', [{ data: { firstName: 'A', lastName: 'B' } }]),
    ).resolves.toBeDefined();
  });
});
