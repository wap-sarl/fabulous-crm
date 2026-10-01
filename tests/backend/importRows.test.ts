import { beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { uniformAccess } from '../../convex/_lib/validators/access';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runAll,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.parse('2026-09-25T09:00:00Z');
beforeEach(() => {
  pinClock(NOW);
});

// Running timers moves the date: it goes back, for the seeded sessions.
const settle = (t: T) => runAll(t, NOW);

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const nina = await seedEmployee(t, { email: 'nina@example.com', role: 'member' });
  const sam = await seedEmployee(t, { email: 'sam@example.com', role: 'member' });
  return {
    t,
    nina,
    as: asIdentity(t, admin.identity),
    asNina: asIdentity(t, nina.identity),
    asSam: asIdentity(t, sam.identity),
  };
}

type As = ReturnType<typeof asIdentity>;
type Row = { data?: Record<string, unknown>; error?: string; raw: string[] };

/** A job of contacts with its rows uploaded, as the SPA does it. */
async function upload(as: As, rows: Row[]): Promise<Id<'importJobs'>> {
  const jobId = await as.mutation(api.features.imports.mutations.createJob, {
    entity: 'lead',
    fileName: 'contacts.csv',
    headers: ['Prénom', 'Nom', 'E-mail'],
    targets: ['firstName', 'lastName', 'email'],
    totalRows: rows.length,
  });
  await as.mutation(api.features.imports.mutations.appendRows, {
    jobId,
    rows: rows.map((row, i) => ({
      index: i,
      line: i + 2,
      raw: row.raw,
      // biome-ignore lint/suspicious/noExplicitAny: rows as the SPA builds them
      data: row.data as any,
      error: row.error,
    })),
  });
  return jobId;
}

async function simulate(t: T, as: As, jobId: Id<'importJobs'>) {
  await as.mutation(api.features.imports.mutations.simulateJob, { jobId });
  await settle(t);
}

const rowsOf = (
  as: As,
  jobId: Id<'importJobs'>,
  outcome: 'create' | 'update' | 'duplicate' | 'created' | 'updated' | 'error',
  paginationOpts: { numItems: number; cursor: string | null } = { numItems: 50, cursor: null },
) => as.query(api.features.imports.queries.listJobRows, { jobId, outcome, paginationOpts });

const rowId = (t: T, jobId: Id<'importJobs'>, index: number) =>
  t.run(async (ctx) => {
    const row = await ctx.db
      .query('importRows')
      .withIndex('by_job_index', (q) => q.eq('jobId', jobId).eq('index', index))
      .unique();
    if (!row) throw new Error(`no row ${index}`);
    return row._id;
  });

/** Five rows: a creation, an update, a probable duplicate, a refused stage and a row the SPA could not build. */
async function simulatedJob(t: T, as: As) {
  const known = await seedLead(t, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
  });
  // Through the mutation: the dedupe keys the duplicate search reads are stamped by the trigger.
  const twin = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Bob',
    lastName: 'Marley',
    phone: '+33612345678',
  });
  const jobId = await upload(as, [
    {
      raw: ['New', 'Person', 'new@example.com'],
      data: { firstName: 'New', lastName: 'Person', email: 'new@example.com' },
    },
    {
      raw: ['Ada', 'Byron', 'ADA@example.com'],
      data: { firstName: 'Ada', lastName: 'Byron', email: 'ADA@example.com' },
    },
    {
      raw: ['Bob', 'Marley', 'bob2@example.com'],
      data: {
        firstName: 'Bob',
        lastName: 'Marley',
        email: 'bob2@example.com',
        phone: '0612345678',
      },
    },
    {
      raw: ['Bad', 'Stage', 'bad@example.com'],
      data: {
        firstName: 'Bad',
        lastName: 'Stage',
        email: 'bad@example.com',
        lifecycleStage: 'nope',
      },
    },
    { raw: ['', 'Sans prénom', ''], error: 'Prénom requis' },
  ]);
  await simulate(t, as, jobId);
  return { jobId, known, twin };
}

describe('the rows of an import job, one outcome at a time', () => {
  test('an outcome no row has gives an empty, finished page', async () => {
    const { t, as } = await setup();
    const { jobId } = await simulatedJob(t, as);
    expect(await rowsOf(as, jobId, 'created')).toMatchObject({ page: [], isDone: true });
    expect(await rowsOf(as, jobId, 'updated')).toMatchObject({ page: [], isDone: true });
  });

  test('a row to create has no match, no error and no reason', async () => {
    const { t, as } = await setup();
    const { jobId } = await simulatedJob(t, as);
    const result = await rowsOf(as, jobId, 'create');
    expect(result.isDone).toBe(true);
    expect(result.page).toEqual([
      {
        _id: await rowId(t, jobId, 0),
        index: 0,
        line: 2,
        raw: ['New', 'Person', 'new@example.com'],
        error: null,
        matchId: null,
        matchLabel: null,
        reasons: [],
      },
    ]);
  });

  test('a row to update names the contact it matched', async () => {
    const { t, as } = await setup();
    const { jobId, known } = await simulatedJob(t, as);
    expect((await rowsOf(as, jobId, 'update')).page).toEqual([
      {
        _id: await rowId(t, jobId, 1),
        index: 1,
        line: 3,
        raw: ['Ada', 'Byron', 'ADA@example.com'],
        error: null,
        matchId: known,
        matchLabel: 'Ada Lovelace (ada@example.com)',
        reasons: [],
      },
    ]);
  });

  test('a probable duplicate names its twin and why it looks like it', async () => {
    const { t, as } = await setup();
    const { jobId, twin } = await simulatedJob(t, as);
    expect((await rowsOf(as, jobId, 'duplicate')).page).toEqual([
      {
        _id: await rowId(t, jobId, 2),
        index: 2,
        line: 4,
        raw: ['Bob', 'Marley', 'bob2@example.com'],
        error: null,
        matchId: twin,
        matchLabel: 'Bob Marley',
        reasons: ['phone', 'same_name'],
      },
    ]);
  });

  test('the rows in error carry their error, in file order', async () => {
    const { t, as } = await setup();
    const { jobId } = await simulatedJob(t, as);
    expect((await rowsOf(as, jobId, 'error')).page).toEqual([
      {
        _id: await rowId(t, jobId, 3),
        index: 3,
        line: 5,
        raw: ['Bad', 'Stage', 'bad@example.com'],
        error: 'unknown_lifecycle_stage',
        matchId: null,
        matchLabel: null,
        reasons: [],
      },
      {
        _id: await rowId(t, jobId, 4),
        index: 4,
        line: 6,
        raw: ['', 'Sans prénom', ''],
        error: 'Prénom requis',
        matchId: null,
        matchLabel: null,
        reasons: [],
      },
    ]);
  });

  test('a page stops at its size and the cursor gives the rest', async () => {
    const { t, as } = await setup();
    const jobId = await upload(
      as,
      ['Un', 'Deux', 'Trois'].map((name) => ({ raw: ['', name, ''], error: 'Prénom requis' })),
    );
    await simulate(t, as, jobId);

    const first = await rowsOf(as, jobId, 'error', { numItems: 2, cursor: null });
    expect(first.isDone).toBe(false);
    expect(first.page.map((row) => [row.index, row.raw[1]])).toEqual([
      [0, 'Un'],
      [1, 'Deux'],
    ]);
    const rest = await rowsOf(as, jobId, 'error', { numItems: 2, cursor: first.continueCursor });
    expect(rest.isDone).toBe(true);
    expect(rest.page.map((row) => [row.index, row.raw[1]])).toEqual([[2, 'Trois']]);
  });

  test('once the job has run only the rows in error are left', async () => {
    const { t, as } = await setup();
    const { jobId } = await simulatedJob(t, as);
    await as.mutation(api.features.imports.mutations.launchJob, {
      jobId,
      duplicatePolicy: 'update',
    });
    await settle(t);

    for (const outcome of ['create', 'update', 'duplicate', 'created', 'updated'] as const) {
      expect((await rowsOf(as, jobId, outcome)).page).toEqual([]);
    }
    expect((await rowsOf(as, jobId, 'error')).page.map((row) => [row.line, row.error])).toEqual([
      [5, 'unknown_lifecycle_stage'],
      [6, 'Prénom requis'],
    ]);
  });
});

describe('who reads the rows of a job', () => {
  test('its author and a settings holder do, another employee is refused', async () => {
    const { t, as, asNina, asSam } = await setup();
    const jobId = await upload(asNina, [{ raw: ['', 'Sans prénom', ''], error: 'Prénom requis' }]);
    await simulate(t, asNina, jobId);

    expect((await rowsOf(asNina, jobId, 'error')).page).toHaveLength(1);
    expect((await rowsOf(as, jobId, 'error')).page).toHaveLength(1);
    await expect(rowsOf(asSam, jobId, 'error')).rejects.toMatchObject({
      data: { code: 'import_not_found' },
    });
  });

  test('a job that is gone is refused', async () => {
    const { t, as } = await setup();
    const jobId = await upload(as, [{ raw: ['', 'Sans prénom', ''], error: 'Prénom requis' }]);
    await t.run((ctx) => ctx.db.delete(jobId));
    await expect(rowsOf(as, jobId, 'error')).rejects.toMatchObject({
      data: { code: 'import_not_found' },
    });
  });

  test('an author whose role lost the contacts no longer reads them', async () => {
    const { t, as, asNina, nina } = await setup();
    const jobId = await upload(asNina, [{ raw: ['', 'Sans prénom', ''], error: 'Prénom requis' }]);
    const key = await as.mutation(api.features.roles.mutations.createRole, {
      label: 'Sans contacts',
      access: { ...uniformAccess('own', false), leads: 'none' },
    });
    await as.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: nina.userId,
      role: key,
    });
    await expect(rowsOf(asNina, jobId, 'error')).rejects.toThrow('Unauthorized: leads');
    expect(await t.run((ctx) => ctx.db.get(jobId))).not.toBeNull();
  });
});
