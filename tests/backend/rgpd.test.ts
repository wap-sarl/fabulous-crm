import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { insertListMember } from '../../convex/lib/leadListMembers';
import { syncLeadScore } from '../../convex/lib/leadScoring';
import { stampLeadSignal } from '../../convex/lib/leadSignals';
import { PURGE_CASCADE_BATCH } from '../../convex/lib/retention';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

const NOW = Date.parse('2026-09-22T10:00:00Z');
const opened: T[] = [];
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});
afterEach(async () => {
  for (const t of opened.splice(0)) await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  jest.useRealTimers();
});

const ADA = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada.rgpd@example.com' };
const BOB = { firstName: 'Bob', lastName: 'Marley', email: 'bob.rgpd@example.com' };

async function setup() {
  const t = createTestConvex();
  opened.push(t);
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  const as = asIdentity(t, admin.identity);
  await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
  return { t, as, asMember: asIdentity(t, member.identity), admin };
}

/** Two contacts with a row in every table the rights cover; only Ada is the subject. */
async function seedWorld({ t, as, admin }: Awaited<ReturnType<typeof setup>>) {
  const ada = await seedLead(t, { ...ADA, lifecycleStage: 'lead' });
  const bob = await seedLead(t, { ...BOB, lifecycleStage: 'lead' });
  const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
    name: 'Bienvenue',
    trigger: { type: 'lead_created' },
    allowReEnrollment: false,
    nodes: [{ id: 'n1', type: 'send_email', subject: 'Hi', htmlBody: '<p>x</p>' }],
    startNodeId: 'n1',
  });
  const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
    name: 'Prospects',
    kind: 'static',
  });
  const dealId = await as.mutation(api.features.deals.mutations.createDeal, {
    title: 'Contrat Ada',
  });
  await t.run((ctx) => ctx.db.patch(dealId, { leadId: ada }));
  const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
    type: 'task',
    title: 'Rappeler',
    leadId: ada,
  });
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['pdf'])));
  const ids = await t.run(async (ctx) => {
    const campaignId = await ctx.db.insert('campaigns', {
      name: 'Newsletter',
      channel: 'email',
      messageType: 'marketing',
      subject: 'Bonjour',
      htmlBody: '<p>Contenu</p>',
      status: 'sent',
      totalCount: 2,
      sentCount: 2,
      failedCount: 0,
      updatedAt: NOW,
    });
    const out: Record<string, Id<'leadNotes'> | Id<'campaignSends'> | Id<'workflowRuns'>> = {};
    for (const [who, leadId] of [
      ['ada', ada],
      ['bob', bob],
    ] as const) {
      out[`${who}Note`] = await ctx.db.insert('leadNotes', {
        leadId,
        content: `Note privée de ${who}`,
        isPinned: false,
        updatedAt: NOW,
      });
      const sendId = await ctx.db.insert('campaignSends', {
        campaignId,
        leadId,
        email: who === 'ada' ? ADA.email : BOB.email,
        params: {},
        status: 'sent',
      });
      out[`${who}Send`] = sendId;
      await ctx.db.insert('campaignLinkTokens', {
        token: `tok-${who}`,
        campaignId,
        sendId,
        leadId,
        linkKey: 'cta',
      });
      await ctx.db.insert('campaignEvents', {
        campaignId,
        sendId,
        leadId,
        type: 'opened',
        eventAt: NOW,
      });
      await ctx.db.insert('lifecycleStageHistory', { leadId, to: 'lead', source: 'manual' });
      await insertListMember(ctx, { listId, leadId });
      await ctx.db.insert('auditLogs', {
        entityType: 'lead',
        entityId: leadId,
        action: 'update',
        userId: admin.userId,
        timestamp: NOW,
        metadata: { changes: { email: { old: null, new: who === 'ada' ? ADA.email : BOB.email } } },
      });
    }
    const runId = await ctx.db.insert('workflowRuns', {
      workflowId,
      leadId: ada,
      status: 'completed',
      triggerType: 'manual',
      enrolledAt: NOW,
      finishedAt: NOW,
      stepCount: 1,
    });
    out.adaRun = runId;
    await ctx.db.insert('workflowRunSteps', {
      runId,
      workflowId,
      leadId: ada,
      nodeId: 'n1',
      nodeType: 'send_email',
      status: 'success',
      startedAt: NOW,
    });
    await ctx.db.insert('auditLogs', {
      entityType: 'leadNote',
      entityId: out.adaNote as string,
      action: 'create',
      userId: admin.userId,
      timestamp: NOW,
      metadata: { content: 'Note privée de ada' },
    });
    await ctx.db.insert('auditLogs', {
      entityType: 'workflowRun',
      entityId: runId,
      action: 'create',
      userId: admin.userId,
      timestamp: NOW,
    });
    const scanId = await ctx.db.insert('duplicateScans', {
      status: 'done',
      scanned: 2,
      found: 1,
      startedBy: admin.userId,
      startedAt: NOW,
    });
    await ctx.db.insert('leadDuplicates', {
      leadAId: ada,
      leadBId: bob,
      reasons: ['same_name'],
      score: 1,
      status: 'open',
      scanId,
      updatedAt: NOW,
    });
    await ctx.db.insert('attachments', {
      entityType: 'lead',
      entityId: ada,
      folder: '',
      name: 'contrat.pdf',
      mimeType: 'application/pdf',
      size: 3,
      provider: 'convex',
      storageId,
      key: `lead/${ada}/contrat.pdf`,
      updatedAt: NOW,
    });
    return out;
  });
  return { ada, bob, listId, dealId, activityId, storageId, ...ids };
}

const rowsAbout = (t: T, leadId: Id<'leads'>) =>
  t.run(async (ctx) => {
    const all = await Promise.all(
      (
        [
          'leadNotes',
          'campaignSends',
          'campaignLinkTokens',
          'campaignEvents',
          'lifecycleStageHistory',
          'leadListMembers',
          'workflowRuns',
          'workflowRunSteps',
        ] as const
      ).map(
        async (table) =>
          (await ctx.db.query(table).collect()).filter((row) => row.leadId === leadId).length,
      ),
    );
    const pairs = (await ctx.db.query('leadDuplicates').collect()).filter(
      (p) => p.leadAId === leadId || p.leadBId === leadId,
    ).length;
    const attachments = (await ctx.db.query('attachments').collect()).filter(
      (a) => a.entityId === leadId,
    ).length;
    return all.reduce((sum, n) => sum + n, 0) + pairs + attachments;
  });

describe('RGPD rights', () => {
  test('access: the export holds every row about the contact and nothing about anyone else, for the settings holders, on the record', async () => {
    const ctx = await setup();
    const { t, as, asMember } = ctx;
    const { ada } = await seedWorld(ctx);
    await expect(
      asMember.action(api.features.rgpd.actions.exportContactData, { leadId: ada }),
    ).rejects.toThrow(/settings access/);
    const { archive, requestId } = await as.action(api.features.rgpd.actions.exportContactData, {
      leadId: ada,
    });
    expect(archive.contact._id).toBe(ada);
    expect(archive.notes.map((n) => n.content)).toEqual(['Note privée de ada']);
    expect(archive.campaigns).toHaveLength(1);
    expect(archive.campaigns[0]).toMatchObject({
      campaign: { name: 'Newsletter', channel: 'email' },
      send: { email: ADA.email },
    });
    expect(archive.campaigns[0]?.events).toHaveLength(1);
    expect(archive.workflows).toHaveLength(1);
    expect(archive.workflows[0]?.workflow?.name).toBe('Bienvenue');
    expect(archive.workflows[0]?.steps).toHaveLength(1);
    expect(archive.lists).toEqual([{ name: 'Prospects', kind: 'static' }]);
    expect(archive.lifecycleHistory).toHaveLength(1);
    expect(archive.deals.map((d) => d.title)).toEqual(['Contrat Ada']);
    expect(archive.activities.map((a) => a.title)).toEqual(['Rappeler']);
    expect(archive.attachments).toEqual([
      expect.objectContaining({ name: 'contrat.pdf', size: 3 }),
    ]);
    expect(archive.audit).toHaveLength(1);
    expect(archive.scoring).toEqual({ excludedFromProfiling: false, score: 0, rules: [] });
    expect(archive.cut).toEqual([]);
    // Nothing of Bob, whatever the table.
    const text = JSON.stringify(archive);
    expect(text).not.toContain(BOB.email);
    expect(text).not.toContain('Marley');
    expect(text).not.toContain('Note privée de bob');
    // On the record: the request row and an audit entry on the contact.
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({ type: 'access', leadId: ada, outcome: 'done' });
    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter(
        (a) =>
          a.entityId === ada && (a.metadata as { rgpd?: string } | undefined)?.rgpd === 'access',
      ),
    );
    expect(audits).toHaveLength(1);
  });

  test('erasure: nothing of the contact remains but one anonymous audit row and the request; the other contact is untouched', async () => {
    const ctx = await setup();
    const { t, as, asMember } = ctx;
    const { ada, bob, dealId, activityId, storageId, listId } = await seedWorld(ctx);
    const bobRowsBefore = await rowsAbout(t, bob);
    await expect(
      asMember.mutation(api.features.rgpd.mutations.eraseContact, { leadId: ada, confirm: true }),
    ).rejects.toThrow(/settings access/);
    await expect(
      as.mutation(api.features.rgpd.mutations.eraseContact, { leadId: ada, confirm: false }),
    ).rejects.toThrow(/erasure_not_confirmed/);
    // A contact already in the trash can be erased too.
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId: ada });
    const requestId = await as.mutation(api.features.rgpd.mutations.eraseContact, {
      leadId: ada,
      confirm: true,
    });
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({ outcome: 'in_progress' });
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());

    expect(await t.run((ctx) => ctx.db.get(ada))).toBeNull();
    expect(await rowsAbout(t, ada)).toBe(0);
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    // The duplicate pair joined the two: it went with Ada; everything else of Bob's stays.
    expect(await rowsAbout(t, bob)).toBe(bobRowsBefore - 1);
    expect(await t.run((ctx) => ctx.db.get(bob))).not.toBeNull();
    // Business records stay, unlinked.
    expect((await t.run((ctx) => ctx.db.get(dealId)))?.leadId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(activityId)))?.leadId).toBeUndefined();
    const lists = await as.query(api.features.crm.queries.listLeadLists, {});
    expect(lists.find((l) => l._id === listId)?.memberCount).toBe(1);
    // The audit trail: the note's and the run's rows gone, and about the contact exactly one anonymous row.
    const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    expect(
      audits.filter((a) => a.entityType === 'leadNote' || a.entityType === 'workflowRun'),
    ).toEqual([]);
    const about = audits.filter((a) => a.entityId === ada);
    expect(about).toHaveLength(1);
    expect(about[0]).toMatchObject({ action: 'delete', metadata: { rgpd: 'erasure', requestId } });
    expect(JSON.stringify(about[0])).not.toMatch(/Ada|Lovelace|ada\.rgpd/);
    expect(audits.filter((a) => a.entityId === bob)).toHaveLength(1);
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request).toMatchObject({ type: 'erasure', leadId: ada, outcome: 'done' });
    expect(
      ((request?.detail ?? {}) as { counts: { leads: number; related: number } }).counts,
    ).toMatchObject({ leads: 1 });
    expect(
      ((request?.detail ?? {}) as { counts: { related: number } }).counts.related,
    ).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(request)).not.toMatch(/Ada|Lovelace|ada\.rgpd/);
  });

  test('a contact with more rows than one step holds is erased over several steps', async () => {
    const ctx = await setup();
    const { t, as } = ctx;
    const ada = await seedLead(t, ADA);
    await t.run(async (ctx) => {
      for (let i = 0; i < PURGE_CASCADE_BATCH * 3; i += 1) {
        await ctx.db.insert('leadNotes', {
          leadId: ada,
          content: `n${i}`,
          isPinned: false,
          updatedAt: NOW,
        });
      }
    });
    const requestId = await as.mutation(api.features.rgpd.mutations.eraseContact, {
      leadId: ada,
      confirm: true,
    });
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(ada))).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.query('leadNotes').collect()).length)).toBe(0);
    const request = await t.run((ctx) => ctx.db.get(requestId));
    expect(request?.outcome).toBe('done');
    expect(((request?.detail ?? {}) as { counts: { related: number } }).counts.related).toBe(
      PURGE_CASCADE_BATCH * 3,
    );
  });

  test('objection: scoring and behavioural counters stop for the contact and resume when lifted, each on the record', async () => {
    const ctx = await setup();
    const { t, as } = ctx;
    await as.mutation(api.features.scoring.mutations.createScoringRule, {
      name: 'Exemple',
      criteria: {
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              {
                field: { kind: 'standard', field: 'email' },
                operator: 'contains',
                value: 'example',
              },
            ],
          },
        ],
      },
      points: 10,
      active: true,
    });
    const ada = await seedLead(t, ADA);
    const lead = () => t.run((ctx) => ctx.db.get(ada));
    const rescore = () =>
      t.run(async (ctx) => {
        const doc = await ctx.db.get(ada);
        await syncLeadScore(ctx, { id: ada, oldDoc: doc, newDoc: doc });
      });
    await rescore();
    expect((await lead())?.leadScore).toBe(10);

    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: ada,
      exclude: true,
    });
    expect(await lead()).toMatchObject({ excludeFromProfiling: true });
    expect((await lead())?.leadScore).toBeUndefined();
    expect((await lead())?.scoreBreakdown).toBeUndefined();
    // A later write does not bring the score back, and an engagement leaves no counter.
    await rescore();
    expect((await lead())?.leadScore).toBeUndefined();
    await t.run((ctx) => stampLeadSignal(ctx, ada, 'email_open', NOW + 1000));
    expect((await lead())?.emailOpenCount).toBeUndefined();
    expect((await lead())?.lastEmailOpenAt).toBeUndefined();
    expect((await lead())?.lastActivityAt).toBe(NOW + 1000);
    // The same again changes nothing and records nothing.
    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: ada,
      exclude: true,
    });

    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: ada,
      exclude: false,
    });
    expect((await lead())?.excludeFromProfiling).toBeUndefined();
    expect((await lead())?.leadScore).toBe(10);
    await t.run((ctx) => stampLeadSignal(ctx, ada, 'email_open', NOW + 2000));
    expect((await lead())?.emailOpenCount).toBe(1);

    const requests = await as.query(api.features.rgpd.queries.listRequests, { leadId: ada });
    expect(requests.map((r) => r.type)).toEqual(['objection_lifted', 'objection']);
    expect(requests[0]?.requestedBy).toBe('Test User');
  });
});
