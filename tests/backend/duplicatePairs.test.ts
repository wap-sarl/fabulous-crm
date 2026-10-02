import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, runDue, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, {
    email: 'ada@example.com',
    role: 'admin',
    firstName: 'Ada',
    lastName: 'Martin',
  });
  const as = asIdentity(t, emp.identity);
  return { t, emp, as };
}
type As = ReturnType<typeof asIdentity>;

const ADDRESS = {
  country: 'FR',
  streetNumber: '12',
  street: 'rue des Lilas',
  postalCode: '69003',
  city: 'Lyon',
};

/** Two records of the same person, found by a scan: the pair row is the one the scan wrote. */
async function scannedPair(t: T, as: As, first: { ownerIds?: Id<'users'>[] } = {}) {
  const companyId = await as.mutation(api.features.companies.mutations.createCompany, {
    name: 'Novalux',
  });
  const full = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Claire',
    lastName: 'Fontaine',
    email: 'claire@example.com',
    phone: '06 12 34 56 78',
    address: ADDRESS,
    comment: 'Rencontrée au salon',
    companyId,
    ...first,
  });
  const bare = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Claire',
    lastName: 'Fontaine',
    phone: '+33 6 12 34 56 78',
  });
  const scanId = await as.mutation(api.features.duplicates.mutations.startDuplicateScan, {});
  await runDue(t);
  const pairs = await t.run((ctx) => ctx.db.query('leadDuplicates').collect());
  expect(pairs).toHaveLength(1);
  return { companyId, full, bare, scanId, pairId: pairs[0]._id };
}

const pairOf = (as: As, pairId: Id<'leadDuplicates'>) =>
  as.query(api.features.duplicates.queries.getDuplicatePair, { pairId });

describe('duplicate pair', () => {
  test('a pair comes with both full leads, the names of their owners and their company', async () => {
    const { t, as, emp } = await setup();
    const leo = await seedEmployee(t, {
      email: 'leo@example.com',
      firstName: 'Léo',
      lastName: 'Garnier',
    });
    const { companyId, full, bare, scanId, pairId } = await scannedPair(t, as, {
      ownerIds: [emp.userId, leo.userId],
    });

    const result = (await pairOf(as, pairId))!;
    expect(result.pair).toMatchObject({
      _id: pairId,
      reasons: ['phone', 'same_name'],
      status: 'open',
      scanId,
    });
    // Side a is the pair's first lead, whichever of the two records that is.
    expect([result.a.lead._id, result.b.lead._id]).toEqual([
      result.pair.leadAId,
      result.pair.leadBId,
    ]);
    const sides = new Map([result.a, result.b].map((side) => [side.lead._id, side]));
    expect(sides.get(full)).toMatchObject({
      lead: {
        firstName: 'Claire',
        lastName: 'Fontaine',
        email: 'claire@example.com',
        phone: '06 12 34 56 78',
        address: ADDRESS,
        comment: 'Rencontrée au salon',
        companyId,
        ownerIds: [emp.userId, leo.userId],
        dedupe: { phone: '+33612345678', name: 'fontaine|claire', postal: '69003' },
      },
      ownerNames: ['Ada Martin', 'Léo Garnier'],
      companyName: 'Novalux',
    });
    const other = sides.get(bare)!;
    expect(other.lead).toMatchObject({ phone: '+33 6 12 34 56 78', ownerIds: [] });
    expect(other.lead.email).toBeUndefined();
    expect(other.lead.companyId).toBeUndefined();
    expect(other.ownerNames).toEqual([]);
    expect(other.companyName).toBeNull();
  });

  test('a deleted company and an owner who no longer exists are left out of the names', async () => {
    const { t, as, emp } = await setup();
    const leo = await seedEmployee(t, {
      email: 'leo@example.com',
      firstName: 'Léo',
      lastName: 'Garnier',
    });
    const { companyId, full, pairId } = await scannedPair(t, as, {
      ownerIds: [leo.userId, emp.userId],
    });
    // The contacts are detached later, in scheduled batches: until then the lead still points to the company.
    await as.mutation(api.features.companies.mutations.deleteCompany, { companyId });
    await t.run((ctx) => ctx.db.delete(leo.userId));

    const result = (await pairOf(as, pairId))!;
    const side = result.a.lead._id === full ? result.a : result.b;
    expect(side.lead.companyId).toBe(companyId);
    expect(side.lead.ownerIds).toEqual([leo.userId, emp.userId]);
    expect(side.ownerNames).toEqual(['Ada Martin']);
    expect(side.companyName).toBeNull();
  });

  test('a pair whose lead was deleted is null, though its row remains', async () => {
    const { t, as } = await setup();
    const { bare, pairId } = await scannedPair(t, as);
    await as.mutation(api.features.leads.mutations.deleteLead, { leadId: bare });

    expect(await t.run((ctx) => ctx.db.get(pairId))).not.toBeNull();
    expect(await pairOf(as, pairId)).toBeNull();
  });

  test('a pair that a merge removed is null', async () => {
    const { t, as } = await setup();
    const { full, bare, pairId } = await scannedPair(t, as);
    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId: full,
      absorbedId: bare,
      fields: {},
    });

    expect(await t.run((ctx) => ctx.db.get(pairId))).toBeNull();
    expect(await pairOf(as, pairId)).toBeNull();
  });
});

/** The continuations of a merge that are waiting to run. */
const pendingRepoints = async (t: T) =>
  (await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect())).filter(
    (job) => job.state.kind === 'pending' && job.name.includes('repointMergedLead'),
  );

const notesOf = async (t: T, leadId: Id<'leads'>) =>
  (
    await t.run((ctx) =>
      ctx.db
        .query('leadNotes')
        .withIndex('by_lead', (q) => q.eq('leadId', leadId))
        .collect(),
    )
  ).length;

async function twoLeads(as: As) {
  const survivorId = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Claire',
    lastName: 'Fontaine',
    email: 'claire@example.com',
  });
  const absorbedId = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Claire',
    lastName: 'Fontaine',
    phone: '06 12 34 56 78',
  });
  return { survivorId, absorbedId };
}

describe('merge continuation', () => {
  test('rows that fit one batch all move to the survivor, and the work is done', async () => {
    const { t, as } = await setup();
    const { survivorId, absorbedId } = await twoLeads(as);
    const noteId = await as.mutation(api.features.leads.mutations.createNote, {
      leadId: absorbedId,
      content: 'Rappeler après le salon',
    });
    const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Envoyer le devis',
      leadId: absorbedId,
    });
    await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Contrat annuel',
      leadId: absorbedId,
    });

    expect(
      await t.mutation(internal.features.duplicates.internal.repointMergedLead, {
        absorbedId,
        survivorId,
      }),
    ).toEqual({ isDone: true });

    const moved = await t.run(async (ctx) => [
      (await ctx.db.get(noteId))?.leadId,
      (await ctx.db.get(activityId))?.leadId,
      (await ctx.db.get(dealId))?.leadId,
    ]);
    expect(moved).toEqual([survivorId, survivorId, survivorId]);
    expect(await pendingRepoints(t)).toEqual([]);
  });

  test('a lead with nothing attached is done at once', async () => {
    const { t, as } = await setup();
    const { survivorId, absorbedId } = await twoLeads(as);
    // All it has is its own stage history, well under a batch.
    expect(
      await t.mutation(internal.features.duplicates.internal.repointMergedLead, {
        absorbedId,
        survivorId,
      }),
    ).toEqual({ isDone: true });
    expect(await pendingRepoints(t)).toEqual([]);
  });

  test('a full batch reports work left and schedules itself until nothing remains', async () => {
    const { t, as, emp } = await setup();
    const { survivorId, absorbedId } = await twoLeads(as);
    // One more note than a batch of 200 moves.
    await t.run(async (ctx) => {
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert('leadNotes', {
          leadId: absorbedId,
          content: `Note ${i + 1}`,
          isPinned: false,
          createdBy: emp.userId,
          updatedAt: Date.now(),
        });
      }
    });

    expect(
      await t.mutation(internal.features.duplicates.internal.repointMergedLead, {
        absorbedId,
        survivorId,
      }),
    ).toEqual({ isDone: false });
    expect(await notesOf(t, survivorId)).toBe(200);
    expect(await notesOf(t, absorbedId)).toBe(1);
    const pending = await pendingRepoints(t);
    expect(pending).toHaveLength(1);
    expect(pending[0].args).toEqual([{ absorbedId, survivorId }]);

    await runDue(t);
    expect(await notesOf(t, survivorId)).toBe(201);
    expect(await notesOf(t, absorbedId)).toBe(0);
    expect(await pendingRepoints(t)).toEqual([]);
  });
});
