import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { RETENTION_BOUNDS } from '../../convex/_lib/validators/retention';
import crons from '../../convex/crons';
import { setExtensionsForTests } from '../../convex/extensions';
import {
  DAY_MS,
  emptyCounts,
  PURGE_CASCADE_BATCH,
  PURGE_ENTITY_PAGE,
  PURGE_WRITE_BUDGET,
  purgePage,
} from '../../convex/lib/retention';
import { insertListMember } from '../../convex/lib/leadListMembers';
import { asIdentity, createTestConvex, seedEmployee, seedLead, type T } from './helpers';

const NOW = Date.parse('2026-09-22T03:30:00Z');
const daysAgo = (days: number) => NOW - days * DAY_MS;
const opened: T[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});
afterEach(async () => {
  for (const t of opened.splice(0)) await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  setExtensionsForTests(null);
  jest.useRealTimers();
});

async function setup() {
  const t = createTestConvex();
  opened.push(t);
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  // Deals need a pipeline to land in.
  await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'Test',
      appUrl: 'https://crm.example.com',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      updatedAt: NOW,
    }),
  );
  return { t, as, emp };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** One run, its continuation pages included. */
async function purge(t: T) {
  await t.mutation(internal.features.retention.internal.runPurge, {});
  await t.finishAllScheduledFunctions(() => jest.runAllTimers());
}
const reports = (t: T) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'retention').eq('entityId', 'purge'))
        .collect()
    ).map(
      (row) =>
        row.metadata as { pages: number; truncated: boolean; counts: Record<string, number> },
    ),
  );
const count = (
  t: T,
  table:
    | 'leads'
    | 'companies'
    | 'deals'
    | 'activities'
    | 'campaignEvents'
    | 'workflowRunSteps'
    | 'campaignLinkTokens'
    | 'invitations'
    | 'apiIdempotencyKeys'
    | 'auditLogs'
    | 'leadNotes'
    | 'campaignSends'
    | 'workflowRuns'
    | 'leadListMembers'
    | 'lifecycleStageHistory'
    | 'leadDuplicates'
    | 'attachments'
    | 'dealStageHistory',
) => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
const trash = (
  t: T,
  id: Id<'leads'> | Id<'companies'> | Id<'deals'> | Id<'activities'>,
  days: number,
) => t.run((ctx) => ctx.db.patch(id, { deletedAt: daysAgo(days) }));

async function campaign(t: T, status: 'sent' | 'failed' | 'sending', updatedAt: number) {
  return t.run((ctx) =>
    ctx.db.insert('campaigns', {
      name: 'Newsletter',
      channel: 'email',
      messageType: 'marketing',
      subject: 'Bonjour',
      htmlBody: '<p>Contenu</p>',
      status,
      totalCount: 1,
      sentCount: 1,
      failedCount: 0,
      updatedAt,
    }),
  );
}
async function sendWith(t: T, campaignId: Id<'campaigns'>, leadId: Id<'leads'>, eventAt: number) {
  return t.run(async (ctx) => {
    const sendId = await ctx.db.insert('campaignSends', {
      campaignId,
      leadId,
      email: 'a@example.com',
      params: {},
      status: 'sent',
    });
    const tokenId = await ctx.db.insert('campaignLinkTokens', {
      token: `tok-${sendId}`,
      campaignId,
      sendId,
      leadId,
      linkKey: 'cta',
    });
    const eventId = await ctx.db.insert('campaignEvents', {
      campaignId,
      sendId,
      leadId,
      type: 'opened',
      eventAt,
    });
    return { sendId, tokenId, eventId };
  });
}
async function workflowWithRun(
  { t, as }: Setup,
  leadId: Id<'leads'>,
  startedAt: number,
  status: 'success' | 'pending' = 'success',
) {
  const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
    name: 'W',
    trigger: { type: 'lead_created' },
    allowReEnrollment: false,
    nodes: [{ id: 'n1', type: 'send_email', subject: 'Hi', htmlBody: '<p>x</p>' }],
    startNodeId: 'n1',
  });
  return t.run(async (ctx) => {
    const runId = await ctx.db.insert('workflowRuns', {
      workflowId,
      leadId,
      status: 'completed',
      triggerType: 'manual',
      enrolledAt: startedAt,
      finishedAt: startedAt,
      stepCount: 1,
    });
    const stepId = await ctx.db.insert('workflowRunSteps', {
      runId,
      workflowId,
      leadId,
      nodeId: 'n1',
      nodeType: 'send_email',
      status,
      startedAt,
    });
    return { runId, stepId };
  });
}

describe('retention purge', () => {
  test('the cron runs the purge every night', () => {
    const purge = Object.values(crons.crons).find((job) =>
      JSON.stringify(job).includes('features/retention/internal:runPurge'),
    );
    expect(purge?.schedule).toMatchObject({ type: 'daily', hourUTC: 3, minuteUTC: 30 });
  });

  test('each table is purged past its retention and kept within it; one audit row carries the counts', async () => {
    const ctx = await setup();
    const { t, as, emp } = ctx;
    const gone = await seedLead(t, { email: 'gone@example.com' });
    const kept = await seedLead(t, { email: 'kept@example.com' });
    const live = await seedLead(t, { email: 'live@example.com' });
    await trash(t, gone, 31);
    await trash(t, kept, 29);
    const oldCompany = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Old',
      country: 'fr',
    });
    const newCompany = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'New',
      country: 'fr',
    });
    await trash(t, oldCompany, 31);
    await trash(t, newCompany, 29);
    const oldDeal = await as.mutation(api.features.deals.mutations.createDeal, { title: 'Old' });
    const newDeal = await as.mutation(api.features.deals.mutations.createDeal, { title: 'New' });
    await trash(t, oldDeal, 31);
    await trash(t, newDeal, 29);
    const oldActivity = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Old',
      leadId: live,
    });
    const newActivity = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'New',
      leadId: live,
    });
    await trash(t, oldActivity, 31);
    await trash(t, newActivity, 29);

    // Events: one just beyond the year, one just within.
    const closedOld = await campaign(t, 'sent', daysAgo(366));
    const closedRecent = await campaign(t, 'failed', daysAgo(364));
    const stillSending = await campaign(t, 'sending', daysAgo(400));
    await sendWith(t, closedOld, live, daysAgo(366));
    await sendWith(t, closedRecent, live, daysAgo(364));
    await sendWith(t, stillSending, live, daysAgo(364));
    await workflowWithRun(ctx, live, daysAgo(366));
    await workflowWithRun(ctx, live, daysAgo(364));
    // A step still pending is a run still parked on it, whatever its age.
    await workflowWithRun(ctx, live, daysAgo(400), 'pending');

    await t.run(async (ctx) => {
      await ctx.db.insert('invitations', {
        email: 'expired@example.com',
        role: 'member',
        status: 'pending',
        invitedAt: daysAgo(10),
        expiresAt: daysAgo(1),
      });
      await ctx.db.insert('invitations', {
        email: 'open@example.com',
        role: 'member',
        status: 'pending',
        invitedAt: daysAgo(10),
        expiresAt: NOW + DAY_MS,
      });
      // No expiry at all: never expired.
      await ctx.db.insert('invitations', {
        email: 'open-ended@example.com',
        role: 'member',
        status: 'pending',
        invitedAt: daysAgo(900),
      });
      await ctx.db.insert('invitations', {
        email: 'accepted@example.com',
        role: 'member',
        status: 'accepted',
        invitedAt: daysAgo(900),
        expiresAt: daysAgo(890),
      });
      const apiKeyId = await ctx.db.insert('apiKeys', {
        keyId: 'k1',
        secretHash: 'h',
        name: 'k',
        scopes: ['contacts:read'],
        updatedAt: NOW,
      });
      await ctx.db.insert('apiIdempotencyKeys', {
        apiKeyId,
        key: 'a',
        fingerprint: 'f',
        status: 'done',
        expiresAt: daysAgo(1),
      });
      await ctx.db.insert('apiIdempotencyKeys', {
        apiKeyId,
        key: 'b',
        fingerprint: 'f',
        status: 'done',
        expiresAt: NOW + DAY_MS,
      });
      await ctx.db.insert('auditLogs', {
        entityType: 'lead',
        entityId: 'x',
        action: 'update',
        timestamp: daysAgo(731),
      });
      await ctx.db.insert('auditLogs', {
        entityType: 'lead',
        entityId: 'y',
        action: 'update',
        timestamp: daysAgo(729),
      });
    });
    // Two finished imports, one past the events retention with its rows in error, one within it.
    const importJob = (finishedAt: number, error: string) =>
      t.run(async (ctx) => {
        const jobId = await ctx.db.insert('importJobs', {
          entity: 'lead',
          fileName: 'f.csv',
          status: 'done',
          headers: ['a'],
          targets: ['firstname'],
          totalRows: 1,
          uploadedRows: 1,
          invalidRows: 1,
          batchSize: 200,
          nextBatch: 1,
          counts: { created: 0, updated: 0, duplicates: 0, errors: 1 },
          finishedAt,
          updatedAt: finishedAt,
          createdBy: emp.userId,
        });
        await ctx.db.insert('importRows', {
          jobId,
          index: 0,
          line: 2,
          raw: [error],
          outcome: 'error',
          error,
        });
        return jobId;
      });
    const oldImport = await importJob(daysAgo(366), 'vieux');
    const newImport = await importJob(daysAgo(364), 'récent');
    const auditBefore = await count(t, 'auditLogs');

    await purge(t);

    const ids = await t.run(async (ctx) => ({
      gone: await ctx.db.get(gone),
      kept: await ctx.db.get(kept),
      live: await ctx.db.get(live),
      oldCompany: await ctx.db.get(oldCompany),
      newCompany: await ctx.db.get(newCompany),
      oldDeal: await ctx.db.get(oldDeal),
      newDeal: await ctx.db.get(newDeal),
      oldActivity: await ctx.db.get(oldActivity),
      newActivity: await ctx.db.get(newActivity),
    }));
    expect(ids.gone).toBeNull();
    expect(ids.kept).not.toBeNull();
    expect(ids.live).not.toBeNull();
    expect(ids.oldCompany).toBeNull();
    expect(ids.newCompany).not.toBeNull();
    expect(ids.oldDeal).toBeNull();
    expect(ids.newDeal).not.toBeNull();
    expect(ids.oldActivity).toBeNull();
    expect(ids.newActivity).not.toBeNull();
    expect(await count(t, 'campaignEvents')).toBe(2);
    expect(await count(t, 'workflowRunSteps')).toBe(2);
    // Only the closed campaign past its retention lost its tokens.
    expect(await count(t, 'campaignLinkTokens')).toBe(2);
    expect(await count(t, 'invitations')).toBe(3);
    expect(await count(t, 'apiIdempotencyKeys')).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(oldImport))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(newImport))).not.toBeNull();
    expect(await count(t, 'importRows')).toBe(1);
    // One old audit row gone, one written by the run.
    expect(await count(t, 'auditLogs')).toBe(auditBefore);
    const [report, ...others] = await reports(t);
    expect(others).toEqual([]);
    expect(report).toMatchObject({
      pages: 1,
      truncated: false,
      counts: {
        leads: 1,
        companies: 1,
        deals: 1,
        activities: 1,
        campaignEvents: 1,
        workflowRunSteps: 1,
        campaignLinkTokens: 1,
        invitations: 1,
        apiIdempotencyKeys: 1,
        importRows: 1,
        importJobs: 1,
        auditLogs: 1,
      },
    });
  });

  test('a purged lead takes everything it owns; a live deal or activity only loses its link', async () => {
    const ctx = await setup();
    const { t, as, emp } = ctx;
    const lead = await seedLead(t, { email: 'lead@example.com', lifecycleStage: 'lead' });
    const other = await seedLead(t, { email: 'other@example.com' });
    const campaignId = await campaign(t, 'sent', NOW);
    await sendWith(t, campaignId, lead, NOW);
    await sendWith(t, campaignId, other, NOW);
    await workflowWithRun(ctx, lead, NOW);
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Static',
      kind: 'static',
    });
    await t.run(async (ctx) => {
      await insertListMember(ctx, { listId, leadId: lead });
      await insertListMember(ctx, { listId, leadId: other });
    });
    const dealId = await as.mutation(api.features.deals.mutations.createDeal, { title: 'Deal' });
    await t.run((ctx) => ctx.db.patch(dealId, { leadId: lead }));
    const activityId = await as.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Call',
      leadId: lead,
    });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['pdf'])));
    await t.run(async (ctx) => {
      await ctx.db.insert('leadNotes', {
        leadId: lead,
        content: 'n',
        isPinned: false,
        updatedAt: NOW,
      });
      await ctx.db.insert('lifecycleStageHistory', { leadId: lead, to: 'lead', source: 'manual' });
      const scanId = await ctx.db.insert('duplicateScans', {
        status: 'done',
        scanned: 2,
        found: 1,
        startedBy: emp.userId,
        startedAt: NOW,
      });
      await ctx.db.insert('leadDuplicates', {
        leadAId: other,
        leadBId: lead,
        reasons: ['email'],
        score: 1,
        status: 'open',
        scanId,
        updatedAt: NOW,
      });
      await ctx.db.insert('attachments', {
        entityType: 'lead',
        entityId: lead,
        folder: '',
        name: 'a.pdf',
        mimeType: 'application/pdf',
        size: 3,
        provider: 'convex',
        storageId,
        key: `lead/${lead}/a.pdf`,
        updatedAt: NOW,
      });
    });
    await trash(t, lead, 31);

    await purge(t);

    expect(await t.run((ctx) => ctx.db.get(lead))).toBeNull();
    expect(await count(t, 'leadNotes')).toBe(0);
    expect(await count(t, 'lifecycleStageHistory')).toBe(0);
    expect(await count(t, 'leadDuplicates')).toBe(0);
    expect(await count(t, 'attachments')).toBe(0);
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await count(t, 'workflowRuns')).toBe(0);
    expect(await count(t, 'workflowRunSteps')).toBe(0);
    // The other lead's rows are untouched.
    expect(await count(t, 'campaignSends')).toBe(1);
    expect(await count(t, 'campaignLinkTokens')).toBe(1);
    expect(await count(t, 'campaignEvents')).toBe(1);
    const members = await t.run((ctx) => ctx.db.query('leadListMembers').collect());
    expect(members.map((m) => m.leadId)).toEqual([other]);
    const lists = await as.query(api.features.crm.queries.listLeadLists, {});
    expect(lists.find((l) => l._id === listId)?.memberCount).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(dealId)))?.leadId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(activityId)))?.leadId).toBeUndefined();
    const [report] = await reports(t);
    expect(report?.counts).toMatchObject({ leads: 1, attachments: 1 });
    expect(report?.counts.related).toBeGreaterThanOrEqual(8);
  });

  test('a run chains pages until every table is under its retention, and reports once', async () => {
    const { t } = await setup();
    const many = 2 * PURGE_ENTITY_PAGE + 5;
    for (let i = 0; i < many; i += 1) {
      const id = await seedLead(t, { email: `bulk-${i}@example.com` });
      await trash(t, id, 40);
    }
    // One lead with more related rows than a page drains over several pages before it goes.
    const heavy = await seedLead(t, { email: 'heavy@example.com' });
    await t.run(async (ctx) => {
      for (let i = 0; i < PURGE_CASCADE_BATCH + 50; i += 1) {
        await ctx.db.insert('leadNotes', {
          leadId: heavy,
          content: `n${i}`,
          isPinned: false,
          updatedAt: NOW,
        });
      }
    });
    await trash(t, heavy, 40);

    await purge(t);

    expect(await count(t, 'leads')).toBe(0);
    expect(await count(t, 'leadNotes')).toBe(0);
    const [report, ...others] = await reports(t);
    expect(others).toEqual([]);
    expect(report?.pages).toBeGreaterThanOrEqual(3);
    expect(report?.truncated).toBe(false);
    expect(report?.counts.leads).toBe(many + 1);
    expect(report?.counts.related).toBe(PURGE_CASCADE_BATCH + 50);
  });

  test('the configured days apply, within the bounds the settings refuse to leave', async () => {
    const { t, as } = await setup();
    const admin = await as.query(api.features.config.queries.getAdminConfig, {});
    expect(admin?.retention).toEqual({ softDeleteDays: 30, eventDays: 365, auditDays: 730 });
    await expect(
      as.mutation(api.features.config.mutations.updateConfig, { retentionSoftDeleteDays: 0 }),
    ).rejects.toThrow(/retention_out_of_bounds:softDeleteDays/);
    await expect(
      as.mutation(api.features.config.mutations.updateConfig, {
        retentionAuditDays: RETENTION_BOUNDS.auditDays.max + 1,
      }),
    ).rejects.toThrow(/retention_out_of_bounds:auditDays/);
    await expect(
      as.mutation(api.features.config.mutations.updateConfig, { retentionEventDays: 90.5 }),
    ).rejects.toThrow(/retention_out_of_bounds:eventDays/);
    await as.mutation(api.features.config.mutations.updateConfig, { retentionSoftDeleteDays: 5 });
    expect((await as.query(api.features.config.queries.getAdminConfig, {}))?.retention).toEqual({
      softDeleteDays: 5,
      eventDays: 365,
      auditDays: 730,
    });
    const week = await seedLead(t, { email: 'week@example.com' });
    const days3 = await seedLead(t, { email: 'days3@example.com' });
    await trash(t, week, 7);
    await trash(t, days3, 3);
    await purge(t);
    expect(await t.run((ctx) => ctx.db.get(week))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(days3))).not.toBeNull();
    const [report] = await reports(t);
    expect(report).toMatchObject({ policy: { softDeleteDays: 5, eventDays: 365, auditDays: 730 } });
  });

  test('a deferred run deletes nothing and comes back; the safety-net recount of dynamic lists follows a run', async () => {
    const { t, as } = await setup();
    const lead = await seedLead(t, { email: 'lead@example.com', lifecycleStage: 'mql' });
    await trash(t, lead, 40);
    const listId = await as.mutation(api.features.crm.mutations.createLeadList, {
      name: 'Dynamic',
      kind: 'dynamic',
      criteria: {
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              {
                field: { kind: 'standard', field: 'lifecycleStage' },
                operator: 'equals',
                value: 'mql',
              },
            ],
          },
        ],
      },
    });
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    const scheduled = (name: string) =>
      t.run(async (ctx) =>
        (await ctx.db.system.query('_scheduled_functions').collect()).filter(
          (row) => row.name.includes(name) && row.state.kind === 'pending',
        ),
      );

    setExtensionsForTests({ beforeScheduledWork: async () => false });
    await t.mutation(internal.features.retention.internal.runPurge, {});
    expect(await t.run((ctx) => ctx.db.get(lead))).not.toBeNull();
    expect(await reports(t)).toEqual([]);
    console.log(
      'DEBUG',
      JSON.stringify(
        (await scheduled('retention/internal:runPurge')).map((r) => [
          r.name,
          r.args,
          r.scheduledTime - NOW,
        ]),
      ),
    );
    expect(await scheduled('retention/internal:runPurge')).toHaveLength(1);

    setExtensionsForTests(null);
    const stampBefore = (await t.run((ctx) => ctx.db.get(listId)))?.lastRecalcAt ?? 0;
    // Allowed again: the deferred run comes back on its own, purges, and reports once.
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(lead))).toBeNull();
    expect(await reports(t)).toHaveLength(1);
    expect(await scheduled('retention/internal:runPurge')).toEqual([]);
    // The safety-net recount ran after the purge: the list carries a later stamp.
    const list = await t.run((ctx) => ctx.db.get(listId));
    expect(list?.lastRecalcAt ?? 0).toBeGreaterThan(stampBefore);
  });

  test('one page never writes more than its budget, whatever the local caps add up to', async () => {
    const { t } = await setup();
    // 20 leads with 150 notes each: every local cap is respected, the sum is not.
    for (let i = 0; i < PURGE_ENTITY_PAGE; i += 1) {
      const id = await seedLead(t, { email: `budget-${i}@example.com` });
      await t.run(async (ctx) => {
        for (let n = 0; n < 150; n += 1) {
          await ctx.db.insert('leadNotes', {
            leadId: id,
            content: `n${n}`,
            isPinned: false,
            updatedAt: NOW,
          });
        }
      });
      await trash(t, id, 40);
    }
    const rowsBefore = (await count(t, 'leads')) + (await count(t, 'leadNotes'));
    const policy = { softDeleteDays: 30, eventDays: 365, auditDays: 730 };
    const page = await t.run((ctx) => purgePage(ctx, policy, NOW));
    const rowsAfter = (await count(t, 'leads')) + (await count(t, 'leadNotes'));
    expect(rowsBefore - rowsAfter).toBeLessThanOrEqual(PURGE_WRITE_BUDGET);
    expect(rowsBefore - rowsAfter).toBeGreaterThan(PURGE_WRITE_BUDGET - PURGE_CASCADE_BATCH);
    expect(page.moreLeft).toBe(true);
    // The run then takes what the manual page left, and reports exactly that.
    await purge(t);
    expect(await count(t, 'leads')).toBe(0);
    expect(await count(t, 'leadNotes')).toBe(0);
    const [report] = await reports(t);
    expect((report?.counts.related ?? 0) + (report?.counts.leads ?? 0)).toBe(rowsAfter);
  });

  test('the policy and the reference time are frozen on the first page: a setting changed mid-run does not apply', async () => {
    const { t, as } = await setup();
    await as.mutation(api.features.config.mutations.updateConfig, { retentionSoftDeleteDays: 5 });
    const week = await seedLead(t, { email: 'week@example.com' });
    await trash(t, week, 7);
    // A continuation page arrives with the policy of its first page, 30 days, while the settings now say 5.
    await t.mutation(internal.features.retention.internal.runPurge, {
      startedAt: NOW,
      page: 2,
      counts: emptyCounts(),
      policy: { softDeleteDays: 30, eventDays: 365, auditDays: 730 },
    });
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(week))).not.toBeNull();
    const [report] = await reports(t);
    expect(report).toMatchObject({ pages: 2, policy: { softDeleteDays: 30 } });
    // The next run starts a fresh page and reads the settings.
    await purge(t);
    expect(await t.run((ctx) => ctx.db.get(week))).toBeNull();
    expect((await reports(t)).at(-1)).toMatchObject({ pages: 1, policy: { softDeleteDays: 5 } });
  });
});
