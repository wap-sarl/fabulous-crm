import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { compareIdentities, levenshtein, phoneKey } from '../../convex/lib/duplicates';
import { insertListMember } from '../../convex/lib/leadListMembers';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const lead = (
    fields: Partial<
      Parameters<typeof as.mutation<typeof api.features.crm.mutations.createLead>>[1]
    > & {
      firstName: string;
      lastName: string;
    },
  ) => as.mutation(api.features.crm.mutations.createLead, fields);
  return { t, emp, as, lead };
}

/** Drive a scan to completion by hand (scheduled continuations don't run in tests). */
async function runScan(t: T, as: ReturnType<typeof asIdentity>) {
  const scanId = await as.mutation(api.features.duplicates.mutations.startDuplicateScan, {});
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const res = await t.mutation(internal.features.duplicates.internal.scanDuplicatesBatch, {
      scanId,
      cursor,
    });
    if (res.isDone) break;
    cursor = res.continueCursor ?? undefined;
  }
  return scanId;
}

const pairs = (as: ReturnType<typeof asIdentity>, status: 'open' | 'ignored' = 'open') =>
  as
    .query(api.features.duplicates.queries.listDuplicatePairs, {
      status,
      paginationOpts: { numItems: 50, cursor: null },
    })
    .then((r) => r.page);

describe('similarity helpers', () => {
  test('phone keys normalize national and international forms alike', () => {
    expect(phoneKey('06 12 34 56 78')).toBe('+33612345678');
    expect(phoneKey('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(phoneKey('0033612345678')).toBe('+33612345678');
    expect(phoneKey('12')).toBeUndefined();
  });

  test('levenshtein with early exit', () => {
    expect(levenshtein('dupont|jean', 'dupond|jean')).toBe(1);
    expect(levenshtein('dupont|jean', 'martin|paul', 2)).toBe(3);
  });

  test('reasons and scores', () => {
    const a = { phone: '+33612345678', name: 'dupont|jean', block: 'dup', postal: '75001' };
    expect(compareIdentities(a, { ...a }).reasons).toEqual(['phone', 'name_postal']);
    expect(compareIdentities(a, { name: 'dupont|jean', block: 'dup' }).reasons).toEqual([
      'same_name',
    ]);
    expect(compareIdentities(a, { name: 'dupond|jean', block: 'dup' }).reasons).toEqual([
      'similar_name',
    ]);
    expect(compareIdentities(a, { name: 'martin|paul', block: 'mar' }).reasons).toEqual([]);
    // Short names never match on similarity alone.
    expect(
      compareIdentities({ name: 'li|an', block: 'li' }, { name: 'lu|an', block: 'lu' }).reasons,
    ).toEqual([]);
  });
});

describe('duplicate scan', () => {
  test('flags shared phones, name + postal code and similar names', async () => {
    const { t, as, lead } = await setup();
    const a = await lead({ firstName: 'Marie', lastName: 'Curie', phone: '+33 6 12 34 56 78' });
    const b = await lead({ firstName: 'Pierre', lastName: 'Dupont', phone: '0612345678' });
    const c = await lead({
      firstName: 'Jean',
      lastName: 'Martin',
      address: {
        country: 'FR',
        streetNumber: '1',
        street: 'rue A',
        postalCode: '75001',
        city: 'Paris',
      },
    });
    const d = await lead({
      firstName: 'Jean',
      lastName: 'Martin',
      phone: '0700000000',
      address: {
        country: 'FR',
        streetNumber: '2',
        street: 'rue B',
        postalCode: '75001',
        city: 'Paris',
      },
    });
    const e = await lead({ firstName: 'Jean', lastName: 'Martine' });
    await lead({ firstName: 'Zoé', lastName: 'Lambert' });

    const scanId = await runScan(t, as);
    const scan = await as.query(api.features.duplicates.queries.getLatestDuplicateScan, {});
    expect(scan).toMatchObject({ _id: scanId, status: 'done', scanned: 6 });

    const found = await pairs(as);
    const key = (x: Id<'leads'>, y: Id<'leads'>) => [x, y].sort().join('+');
    const byPair = new Map(found.map((p) => [key(p.leadAId, p.leadBId), p.reasons]));
    expect(byPair.get(key(a, b))).toEqual(['phone']);
    expect(byPair.get(key(c, d))).toEqual(['name_postal']);
    expect(byPair.get(key(c, e))).toEqual(['similar_name']);
    expect(byPair.get(key(d, e))).toEqual(['similar_name']);
    expect(found).toHaveLength(4);
    // Strongest first.
    expect(found[0].reasons).toEqual(['phone']);
    expect(found[0].leadA.phone).toBeDefined();

    // Ignoring survives a rescan; a rescan never duplicates pairs.
    await as.mutation(api.features.duplicates.mutations.ignoreDuplicatePair, {
      pairId: found[0]._id,
    });
    await runScan(t, as);
    expect(await pairs(as)).toHaveLength(3);
    expect((await pairs(as, 'ignored')).map((p) => p._id)).toEqual([found[0]._id]);
    expect((await as.query(api.features.duplicates.queries.countOpenDuplicates, {})).count).toBe(3);
  });

  test('keys are stamped on every write, so an edited phone is found without a rescan', async () => {
    const { t, as, lead } = await setup();
    const a = await lead({ firstName: 'Marie', lastName: 'Curie', phone: '0611111111' });
    const b = await lead({ firstName: 'Paul', lastName: 'Langevin' });
    await runScan(t, as);
    expect(await pairs(as)).toHaveLength(0);
    await as.mutation(api.features.crm.mutations.updateLead, { leadId: b, phone: '+33611111111' });
    expect((await t.run((ctx) => ctx.db.get(b)))?.dedupe?.phone).toBe('+33611111111');
    await runScan(t, as);
    const found = await pairs(as);
    expect(found).toHaveLength(1);
    expect([found[0].leadAId, found[0].leadBId].sort()).toEqual([a, b].sort());
  });
});

describe('merge', () => {
  test('keeps the chosen fields, re-points every related row and stays consistent', async () => {
    const { t, as, emp, lead } = await setup();
    const survivorId = await lead({
      firstName: 'Marie',
      lastName: 'Curie',
      email: 'marie@example.com',
      comment: 'Ancienne fiche',
    });
    const absorbedId = await lead({
      firstName: 'Marie',
      lastName: 'Curie',
      phone: '0612345678',
      comment: 'Nouvelle fiche',
    });
    await t.run((ctx) =>
      ctx.db.patch(absorbedId, {
        marketingConsent: ['sms'],
        consentUpdatedAt: Date.now(),
        consentSource: 'public_link',
      }),
    );
    // Related rows on the absorbed lead.
    await as.mutation(api.features.crm.mutations.createNote, {
      leadId: absorbedId,
      content: 'Note',
    });
    await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Rappeler',
      leadId: absorbedId,
    });
    await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
      title: 'Contrat',
      leadId: absorbedId,
    });
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'W',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'create_task', title: 'T' }],
      startNodeId: 'n1',
    });
    const listShared = await as.mutation(api.features.crm.mutations.createLeadList, { name: 'L1' });
    const listOnly = await as.mutation(api.features.crm.mutations.createLeadList, { name: 'L2' });
    const { runId, sendId, tokenId, eventId } = await t.run(async (ctx) => {
      const runId = await ctx.db.insert('workflowRuns', {
        workflowId,
        leadId: absorbedId,
        status: 'completed',
        triggerType: 'manual',
        enrolledAt: Date.now(),
        stepCount: 0,
      });
      const campaignId = await ctx.db.insert('campaigns', {
        name: 'C',
        status: 'sent',
        totalCount: 1,
        sentCount: 1,
        failedCount: 0,
        updatedAt: Date.now(),
      });
      const sendId = await ctx.db.insert('campaignSends', {
        campaignId,
        leadId: absorbedId,
        params: {},
        status: 'sent',
      });
      const tokenId = await ctx.db.insert('campaignLinkTokens', {
        token: 'tok',
        campaignId,
        sendId,
        leadId: absorbedId,
        linkKey: 'k',
      });
      const eventId = await ctx.db.insert('campaignEvents', {
        campaignId,
        sendId,
        leadId: absorbedId,
        type: 'opened',
        eventAt: Date.now(),
      });
      for (const [listId, leadId] of [
        [listShared, survivorId],
        [listShared, absorbedId],
        [listOnly, absorbedId],
      ] as const) {
        await insertListMember(ctx, { listId, leadId, addedBy: emp.userId });
      }
      return { runId, sendId, tokenId, eventId };
    });
    await runScan(t, as);
    expect(await pairs(as)).toHaveLength(1);
    const totalBefore = (await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {}))
      .total;

    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId,
      absorbedId,
      fields: { phone: '0612345678', comment: 'Nouvelle fiche', lifecycleStage: 'mql' },
    });

    const survivor = (await t.run((ctx) => ctx.db.get(survivorId)))!;
    expect(survivor).toMatchObject({
      email: 'marie@example.com',
      phone: '0612345678',
      comment: 'Nouvelle fiche',
      lifecycleStage: 'mql',
      marketingConsent: ['sms'],
      consentSource: 'public_link',
    });
    expect(survivor.dedupe?.phone).toBe('+33612345678');
    const absorbed = (await t.run((ctx) => ctx.db.get(absorbedId)))!;
    expect(absorbed.deletedAt).toBeDefined();

    const pointsTo = async (
      table:
        | 'leadNotes'
        | 'activities'
        | 'deals'
        | 'workflowRuns'
        | 'lifecycleStageHistory'
        | 'campaignSends'
        | 'campaignEvents',
      id: Id<'leads'>,
    ) =>
      (await t.run((ctx) => ctx.db.query(table).collect())).filter((r) => r.leadId === id).length;
    for (const table of [
      'leadNotes',
      'activities',
      'deals',
      'workflowRuns',
      'campaignSends',
      'campaignEvents',
    ] as const) {
      expect(await pointsTo(table, absorbedId)).toBe(0);
    }
    expect(await pointsTo('lifecycleStageHistory', survivorId)).toBe(3); // 2 initial + merge move
    expect((await t.run((ctx) => ctx.db.get(dealId)))?.leadId).toBe(survivorId);
    expect((await t.run((ctx) => ctx.db.get(runId)))?.leadId).toBe(survivorId);
    expect((await t.run((ctx) => ctx.db.get(sendId)))?.leadId).toBe(survivorId);
    expect((await t.run((ctx) => ctx.db.get(tokenId)))?.leadId).toBe(survivorId);
    expect((await t.run((ctx) => ctx.db.get(eventId)))?.leadId).toBe(survivorId);

    // Memberships: one row per list for the survivor, none left for the absorbed lead.
    const members = await t.run((ctx) => ctx.db.query('leadListMembers').collect());
    expect(members.map((m) => [m.listId, m.leadId]).sort()).toEqual(
      [
        [listShared, survivorId],
        [listOnly, survivorId],
      ].sort(),
    );
    const lists = await as.query(api.features.crm.queries.listLeadLists, {});
    expect(Object.fromEntries(lists.map((l) => [l.name, l.memberCount]))).toEqual({ L1: 1, L2: 1 });

    // Counters and search stay exact.
    const totalAfter = (await as.query(api.features.crm.queries.countLeadsByLifecycleStage, {}))
      .total;
    expect(totalAfter).toBe(totalBefore - 1);
    const hits = await as.query(api.features.crm.queries.searchLeads, { search: '0612345678' });
    expect(hits.map((h) => h._id)).toEqual([survivorId]);

    // Pairs of the absorbed lead are gone; the merge is audited on the survivor.
    expect(await pairs(as)).toHaveLength(0);
    const audits = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'lead').eq('entityId', survivorId))
        .collect(),
    );
    const merge = audits.find((a) => a.action === 'merge');
    expect(merge?.metadata).toMatchObject({
      absorbedLeadId: absorbedId,
      absorbedLeadName: 'Marie Curie',
    });
    const timeline = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId: survivorId,
      kinds: ['audit'],
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(
      timeline.page.some(
        (e) => e.kind === 'audit' && e.action === 'merge' && e.absorbedLeadName === 'Marie Curie',
      ),
    ).toBe(true);

    await expect(
      as.mutation(api.features.duplicates.mutations.mergeLeads, {
        survivorId,
        absorbedId,
        fields: {},
      }),
    ).rejects.toThrow('lead_not_found');
  });
});

describe('import duplicate check', () => {
  test('previews non-email matches and lets a row update the matched lead', async () => {
    const { t, as, lead } = await setup();
    const existing = await lead({ firstName: 'Marie', lastName: 'Curie', phone: '0612345678' });
    const byEmail = await lead({
      firstName: 'Paul',
      lastName: 'Langevin',
      email: 'paul@example.com',
    });

    const matches = await as.query(api.features.duplicates.queries.findImportMatches, {
      rows: [
        { firstName: 'M.', lastName: 'Curie', phone: '+33 6 12 34 56 78' },
        { firstName: 'Paul', lastName: 'Langevin', email: 'paul@example.com', phone: '0699999999' },
        { firstName: 'Zoé', lastName: 'Lambert' },
      ],
    });
    expect(matches).toEqual([
      { index: 0, leadId: existing, leadName: 'Marie Curie', leadEmail: null, reasons: ['phone'] },
    ]);

    const res = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        {
          firstName: 'Marie',
          lastName: 'Curie',
          phone: '+33 6 12 34 56 78',
          comment: 'CSV',
          matchLeadId: existing,
        },
        { firstName: 'Paul', lastName: 'Langevin', email: 'paul@example.com', phone: '0699999999' },
      ],
    });
    expect(res).toMatchObject({ created: 0, updated: 2 });
    expect((await t.run((ctx) => ctx.db.get(existing)))?.comment).toBe('CSV');
    expect((await t.run((ctx) => ctx.db.get(byEmail)))?.phone).toBe('0699999999');
    expect((await t.run((ctx) => ctx.db.query('leads').collect())).length).toBe(2);
  });
});
