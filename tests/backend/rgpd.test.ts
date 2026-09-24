import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import crons from '../../convex/crons';
import type { Id } from '../../convex/_generated/dataModel';
import { insertListMember } from '../../convex/lib/leadListMembers';
import { syncLeadScore } from '../../convex/lib/leadScoring';
import { stampLeadSignal } from '../../convex/lib/leadSignals';
import { PURGE_CASCADE_BATCH } from '../../convex/lib/retention';
import { uniformAccess } from '../../convex/_lib/validators/access';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

const NOW = Date.parse('2026-09-22T10:00:00Z');
const SECRET = 'rgpd-webhook-secret';
const opened: T[] = [];
beforeEach(() => {
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.BREVO_WEBHOOK_SECRET = SECRET;
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});
afterEach(async () => {
  for (const t of opened.splice(0)) await settle(t);
  jest.useRealTimers();
});

/** Runs the scheduled work; the fake clock lands on the real time afterwards, so it goes back to NOW for the seeded sessions. */
async function settle(t: T) {
  await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  jest.setSystemTime(new Date(NOW));
}

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
    // The person's data, not the record's plumbing.
    expect(archive.contact).toMatchObject({ firstName: 'Ada', email: ADA.email });
    for (const key of [
      'consentToken',
      'searchText',
      'dedupe',
      'ownerIds',
      'createdBy',
      'updatedBy',
    ]) {
      expect(archive.contact).not.toHaveProperty(key);
    }
    const adaDoc = await t.run((ctx) => ctx.db.get(ada));
    expect(JSON.stringify(archive)).not.toContain(adaDoc?.consentToken ?? 'consent-token');
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

  test('access: the settings switch does not widen a role limited to its own contacts; the rights follow the visibility', async () => {
    const { t, as, admin } = await setup();
    const support = await seedEmployee(t, { email: 'support@example.com' });
    const role = await as.mutation(api.features.roles.mutations.createRole, {
      label: 'Support',
      access: uniformAccess('own', true),
    });
    await as.mutation(api.features.users.mutations.setEmployeeRole, {
      userId: support.userId,
      role,
    });
    const asSupport = asIdentity(t, support.identity);
    // An unowned contact is the pool, visible to all: Ada belongs to the admin.
    const ada = await seedLead(t, { ...ADA, ownerIds: [admin.userId] });
    const own = await seedLead(t, { ...BOB, ownerIds: [support.userId] });

    // Out of the perimeter: the contact does not exist for this role, whatever the right.
    await expect(
      asSupport.action(api.features.rgpd.actions.exportContactData, { leadId: ada }),
    ).rejects.toThrow(/lead_not_found/);
    await expect(
      asSupport.mutation(api.features.rgpd.mutations.eraseContact, { leadId: ada, confirm: true }),
    ).rejects.toThrow(/lead_not_found/);
    await expect(
      asSupport.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
        leadId: ada,
        exclude: true,
      }),
    ).rejects.toThrow(/lead_not_found/);
    expect(await t.run((ctx) => ctx.db.query('rgpdRequests').collect())).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(ada)))?.excludeFromProfiling).toBeUndefined();

    // Its own contact: every right works as for the admin.
    const { archive } = await asSupport.action(api.features.rgpd.actions.exportContactData, {
      leadId: own,
    });
    expect(archive.contact._id).toBe(own);
    await asSupport.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: own,
      exclude: true,
    });
    expect(await t.run((ctx) => ctx.db.get(own))).toMatchObject({ excludeFromProfiling: true });
    await asSupport.mutation(api.features.rgpd.mutations.eraseContact, {
      leadId: own,
      confirm: true,
    });
    await settle(t);
    expect(await t.run((ctx) => ctx.db.get(own))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ada))).not.toBeNull();
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
    await settle(t);

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
    await settle(t);
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

  test('objection: opens, clicks and tracked-link clicks are turned away at the door, delivery is still logged', async () => {
    const ctx = await setup();
    const { t, as } = ctx;
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Relance',
      trigger: { type: 'campaign_email_event', event: 'opened' },
      allowReEnrollment: false,
      nodes: [
        {
          id: 'n1',
          type: 'update_property',
          target: { kind: 'standard', field: 'comment' },
          value: 'a ouvert',
        },
      ],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    const ada = await seedLead(t, ADA);
    const bob = await seedLead(t, BOB);
    const sends = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert('campaigns', {
        name: 'Offre',
        channel: 'email',
        messageType: 'marketing',
        subject: 'Offre',
        htmlBody: '<p>Offre</p>',
        status: 'sent',
        totalCount: 2,
        sentCount: 2,
        failedCount: 0,
        updatedAt: NOW,
        trackedLinks: [
          {
            key: 'cta',
            label: 'Intéressé',
            target: { kind: 'standard', field: 'lastName' },
            value: 'Intéressée',
            redirectUrl: 'https://example.com/offre',
          },
        ],
      });
      const out = {} as Record<'ada' | 'bob', Id<'campaignSends'>>;
      for (const [who, leadId] of [
        ['ada', ada],
        ['bob', bob],
      ] as const) {
        out[who] = await ctx.db.insert('campaignSends', {
          campaignId,
          leadId,
          email: who === 'ada' ? ADA.email : BOB.email,
          params: {},
          status: 'sent',
          brevoMessageId: `msg-${who}`,
        });
        await ctx.db.insert('campaignLinkTokens', {
          token: `tok-${who}`,
          campaignId,
          sendId: out[who],
          leadId,
          linkKey: 'cta',
        });
      }
      return out;
    });
    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: ada,
      exclude: true,
    });

    const post = (who: 'ada' | 'bob', event: string, ts: number) =>
      t.fetch(`/webhooks/brevo/email?secret=${SECRET}`, {
        method: 'POST',
        body: JSON.stringify({ event, 'message-id': `msg-${who}`, ts_epoch: ts }),
      });
    expect((await post('ada', 'opened', NOW + 1)).status).toBe(200);
    expect((await post('ada', 'click', NOW + 2)).status).toBe(200);
    expect((await post('ada', 'delivered', NOW + 3)).status).toBe(200);
    expect((await post('bob', 'opened', NOW + 4)).status).toBe(200);
    await settle(t);

    // Ada: the delivery is on the record, nothing of what she did is, and no workflow saw her.
    const eventsOf = (leadId: Id<'leads'>) =>
      t.run(async (ctx) =>
        (await ctx.db.query('campaignEvents').collect())
          .filter((e) => e.leadId === leadId)
          .map((e) => e.type),
      );
    expect(await eventsOf(ada)).toEqual(['delivered']);
    const adaSend = await t.run((ctx) => ctx.db.get(sends.ada));
    expect(adaSend?.openedAt).toBeUndefined();
    expect(adaSend?.clickedAt).toBeUndefined();
    const adaLead = await t.run((ctx) => ctx.db.get(ada));
    expect(adaLead?.emailOpenCount).toBeUndefined();
    expect(adaLead?.emailClickCount).toBeUndefined();
    expect(adaLead?.lastEmailOpenAt).toBeUndefined();
    expect(adaLead?.comment).toBeUndefined();
    const runsOf = (leadId: Id<'leads'>) =>
      t.run(async (ctx) =>
        (await ctx.db.query('workflowRuns').collect()).filter((r) => r.leadId === leadId),
      );
    expect(await runsOf(ada)).toEqual([]);
    // Bob, who did not object, is tracked as before: the test would notice a gate that closed on everyone.
    expect(await eventsOf(bob)).toEqual(['opened']);
    expect((await t.run((ctx) => ctx.db.get(sends.bob)))?.openedAt).toBe(NOW + 4);
    expect((await t.run((ctx) => ctx.db.get(bob)))?.emailOpenCount).toBe(1);
    expect(await runsOf(bob)).toHaveLength(1);

    // The tracked link still leads where it should, and writes nothing about Ada.
    const adaClick = await t.fetch('/l/tok-ada');
    expect(adaClick.status).toBe(302);
    expect(adaClick.headers.get('Location')).toBe('https://example.com/offre');
    await settle(t);
    expect(await eventsOf(ada)).toEqual(['delivered']);
    const adaAfterClick = await t.run((ctx) => ctx.db.get(ada));
    expect(adaAfterClick?.lastName).toBe(ADA.lastName);
    expect(adaAfterClick?.emailClickCount).toBeUndefined();
    const adaToken = await t.run(async (ctx) =>
      (await ctx.db.query('campaignLinkTokens').collect()).find((r) => r.token === 'tok-ada'),
    );
    expect(adaToken?.clickedAt).toBeUndefined();
    const bobClick = await t.fetch('/l/tok-bob');
    expect(bobClick.status).toBe(302);
    await settle(t);
    expect(await eventsOf(bob)).toEqual(['opened', 'link_click']);
    expect((await t.run((ctx) => ctx.db.get(bob)))?.lastName).toBe('Intéressée');

    // Lifted, the next open counts again.
    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: ada,
      exclude: false,
    });
    expect((await post('ada', 'opened', NOW + 10)).status).toBe(200);
    expect(await eventsOf(ada)).toEqual(['delivered', 'opened']);
    expect((await t.run((ctx) => ctx.db.get(sends.ada)))?.openedAt).toBe(NOW + 10);
  });

  test('objection: a merge of duplicates keeps the objection of the absorbed contact, on the record', async () => {
    const { t, as } = await setup();
    const survivor = await seedLead(t, ADA);
    const absorbed = await seedLead(t, BOB);
    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: absorbed,
      exclude: true,
    });
    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId: survivor,
      absorbedId: absorbed,
      fields: {},
    });
    expect((await t.run((ctx) => ctx.db.get(survivor)))?.excludeFromProfiling).toBe(true);
    await t.run((ctx) => stampLeadSignal(ctx, survivor, 'email_open', NOW + 1000));
    expect((await t.run((ctx) => ctx.db.get(survivor)))?.emailOpenCount).toBeUndefined();
    const requests = await as.query(api.features.rgpd.queries.listRequests, { leadId: survivor });
    expect(requests.map((r) => r.type)).toEqual(['objection']);
    const row = await t.run(async (ctx) =>
      (await ctx.db.query('rgpdRequests').collect()).find((r) => r.leadId === survivor),
    );
    expect(row?.detail).toEqual({ carriedFrom: absorbed });

    // The other way round: the survivor's own objection stays, and nothing new is recorded.
    const other = await seedLead(t, {
      firstName: 'Carl',
      lastName: 'Sagan',
      email: 'carl@example.com',
    });
    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId: survivor,
      absorbedId: other,
      fields: {},
    });
    expect((await t.run((ctx) => ctx.db.get(survivor)))?.excludeFromProfiling).toBe(true);
    expect(
      await as.query(api.features.rgpd.queries.listRequests, { leadId: survivor }),
    ).toHaveLength(1);
  });

  test('erasure: a request left in progress by a failed step is taken up again by the hourly resume', async () => {
    const resume = Object.values(crons.crons).find((job) =>
      JSON.stringify(job).includes('features/rgpd/internal:resumeStalledErasures'),
    );
    expect(resume?.schedule).toMatchObject({ type: 'hourly', minuteUTC: 20 });
    const { t, admin } = await setup();
    const stalled = await seedLead(t, ADA);
    const fresh = await seedLead(t, BOB);
    const [stalledRequest, freshRequest] = await t.run((ctx) =>
      Promise.all([
        ctx.db.insert('rgpdRequests', {
          type: 'erasure',
          leadId: stalled,
          requestedBy: admin.userId,
          requestedAt: NOW - 60 * 60_000,
          outcome: 'in_progress',
        }),
        ctx.db.insert('rgpdRequests', {
          type: 'erasure',
          leadId: fresh,
          requestedBy: admin.userId,
          requestedAt: NOW,
          outcome: 'in_progress',
        }),
      ]),
    );
    expect(await t.mutation(internal.features.rgpd.internal.resumeStalledErasures, {})).toBe(1);
    await settle(t);
    expect(await t.run((ctx) => ctx.db.get(stalled))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(stalledRequest))).toMatchObject({
      outcome: 'done',
      detail: { resumed: 1 },
    });
    // A request younger than the stall age is left to its own steps.
    expect(await t.run((ctx) => ctx.db.get(fresh))).not.toBeNull();
    expect((await t.run((ctx) => ctx.db.get(freshRequest)))?.outcome).toBe('in_progress');
  });
});
