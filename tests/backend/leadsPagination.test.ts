/**
 * Real cursor pagination of the leads list (#11): index selection, residual
 * per-page filtering (sparse pages), and cursor continuity. The old
 * implementation read the whole table on every call.
 */
import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}

type PageArgs = Partial<{
  sortField: 'recent' | 'lastName' | 'status';
  sortDirection: 'asc' | 'desc';
  statuses: Doc<'leads'>['status'][];
  assignedToIds: Id<'users'>[];
  listIds: Id<'leadLists'>[];
  search: string;
}>;

/** Walk the cursor to exhaustion, returning all pages' rows plus page sizes. */
async function collectAllPages(
  as: ReturnType<typeof asIdentity>,
  args: PageArgs,
  numItems: number,
) {
  const rows: Doc<'leads'>[] = [];
  const pageSizes: number[] = [];
  let cursor: string | null = null;
  for (;;) {
    const res = await as.query(api.features.crm.queries.listLeadsPaginated, {
      ...args,
      paginationOpts: { numItems, cursor },
    });
    rows.push(...res.page);
    pageSizes.push(res.page.length);
    if (res.isDone) return { rows, pageSizes };
    cursor = res.continueCursor;
  }
}

describe('listLeadsPaginated', () => {
  test('walks the whole table across pages without duplicates, most recent first', async () => {
    const { t, as } = await setup();
    const ids: Id<'leads'>[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await seedLead(t, { email: `walk-${i}@example.com` }));
    }

    const { rows, pageSizes } = await collectAllPages(as, {}, 2);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r._id)).size).toBe(5);
    expect(pageSizes).toEqual([2, 2, 1]);
    // Default sort: newest first.
    const times = rows.map((r) => r._creationTime);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test('a single-status filter rides the index and returns dense pages', async () => {
    const { t, as } = await setup();
    for (let i = 0; i < 4; i++) await seedLead(t, { status: 'nouveau' });
    for (let i = 0; i < 3; i++) await seedLead(t, { status: 'converti' });

    const { rows, pageSizes } = await collectAllPages(as, { statuses: ['nouveau'] }, 2);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === 'nouveau')).toBe(true);
    // Index-served predicate: pages are dense (no filtered-out rows consumed).
    expect(pageSizes).toEqual([2, 2]);
  });

  test('a single assignee (with and without a status) uses the composite index', async () => {
    const { t, emp, as } = await setup();
    const other = await seedEmployee(t, { email: 'other@example.com' });
    await seedLead(t, { assignedTo: emp.userId, status: 'nouveau' });
    await seedLead(t, { assignedTo: emp.userId, status: 'converti' });
    await seedLead(t, { assignedTo: other.userId, status: 'nouveau' });
    await seedLead(t, {});

    const mine = await collectAllPages(as, { assignedToIds: [emp.userId] }, 10);
    expect(mine.rows).toHaveLength(2);
    expect(mine.rows.every((r) => r.assignedTo === emp.userId)).toBe(true);

    const mineNew = await collectAllPages(
      as,
      { assignedToIds: [emp.userId], statuses: ['nouveau'] },
      10,
    );
    expect(mineNew.rows).toHaveLength(1);
    expect(mineNew.rows[0]?.status).toBe('nouveau');
  });

  test('residual filters yield sparse pages but the cursor still finds every match', async () => {
    const { t, as } = await setup();
    // 6 leads; the 2 matches are far apart so they land on different raw pages.
    await seedLead(t, { firstName: 'Cible', email: 'far-1@example.com' });
    for (let i = 0; i < 4; i++) await seedLead(t, { email: `noise-${i}@example.com` });
    await seedLead(t, { firstName: 'Cible', email: 'far-2@example.com' });

    const { rows, pageSizes } = await collectAllPages(as, { search: 'cible' }, 2);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.firstName === 'Cible')).toBe(true);
    // Sparse pages are expected: raw pages of 2 minus non-matching rows.
    expect(pageSizes.some((n) => n < 2)).toBe(true);
  });

  test('soft-deleted leads never appear', async () => {
    const { t, as } = await setup();
    await seedLead(t, { email: 'alive@example.com' });
    await seedLead(t, { email: 'dead@example.com', deletedAt: Date.now() });

    const { rows } = await collectAllPages(as, {}, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('alive@example.com');
  });

  test('sorting by lastName follows the by_lastName index in both directions', async () => {
    const { t, as } = await setup();
    for (const name of ['Zola', 'Arnaud', 'Moreau']) {
      await seedLead(t, { lastName: name });
    }

    const asc = await collectAllPages(as, { sortField: 'lastName', sortDirection: 'asc' }, 2);
    expect(asc.rows.map((r) => r.lastName)).toEqual(['Arnaud', 'Moreau', 'Zola']);
    const desc = await collectAllPages(as, { sortField: 'lastName', sortDirection: 'desc' }, 2);
    expect(desc.rows.map((r) => r.lastName)).toEqual(['Zola', 'Moreau', 'Arnaud']);
  });

  test('list membership is applied per page', async () => {
    const { t, emp, as } = await setup();
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Pagination',
    });
    const inList = await seedLead(t, { email: 'member@example.com' });
    await seedLead(t, { email: 'outsider@example.com' });
    await t.run(async (ctx) => {
      await ctx.db.insert('leadListMembers', { listId, leadId: inList, addedBy: emp.userId });
    });

    const { rows } = await collectAllPages(as, { listIds: [listId] }, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(inList);
  });
});
