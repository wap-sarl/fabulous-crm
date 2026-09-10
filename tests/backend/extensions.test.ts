import { afterEach, describe, expect, test } from 'bun:test';
import type { HttpRouter } from 'convex/server';
import { ConvexError } from 'convex/values';
import { SCHEDULED_WORK_RETRY_MS } from '../../convex/lib/extensionTypes';
import { api, internal } from '../../convex/_generated/api';
import { extensions, setExtensionsForTests } from '../../convex/extensions';
import { asIdentity, createTestConvex, seedEmployee, seedLead } from './helpers';

afterEach(() => setExtensionsForTests(null));

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  return { t, as: asIdentity(t, emp.identity) };
}

describe('extension seam', () => {
  test('beforeEmployeeCall can refuse every employee entry point', async () => {
    const { as } = await setup();
    expect(await as.query(api.features.config.queries.getLifecycleConfig, {})).toBeTruthy();
    setExtensionsForTests({
      beforeEmployeeCall: async () => {
        throw new Error('tenant_suspended');
      },
    });
    await expect(as.query(api.features.config.queries.getLifecycleConfig, {})).rejects.toThrow(
      /tenant_suspended/,
    );
    await expect(
      as.mutation(api.features.crm.mutations.createLead, { firstName: 'A', lastName: 'B' }),
    ).rejects.toThrow(/tenant_suspended/);
  });

  test('publicConfig adds pre-auth fields without shadowing the core ones', async () => {
    const { t } = await setup();
    setExtensionsForTests({
      publicConfig: async () => ({ tenant: 'acme', organizationName: 'hijacked' }),
    });
    const config = await t.query(api.features.config.queries.getPublicConfig, {});
    expect(config).toMatchObject({ tenant: 'acme' });
    expect(config.organizationName).not.toBe('hijacked');
  });

  test('beforeInvitation sees the open invitations and can refuse', async () => {
    const { as } = await setup();
    const seen: number[] = [];
    setExtensionsForTests({
      beforeInvitation: async (_ctx, { stage, pending }) => {
        seen.push(pending);
        if (stage === 'create' && pending >= 1) throw new Error('seat_limit_reached');
      },
    });
    const invite = (email: string) =>
      as.mutation(api.features.invitations.mutations.createInvitation, { email, role: 'member' });
    await invite('one@example.com');
    await expect(invite('two@example.com')).rejects.toThrow(/seat_limit_reached/);
    expect(seen).toEqual([0, 1]);
  });

  test('beforeLeadCreate is told the count and the source, and can refuse', async () => {
    const { t, as } = await setup();
    const calls: { count: number; source: string }[] = [];
    setExtensionsForTests({
      beforeLeadCreate: async (_ctx, info) => {
        calls.push(info);
        if (info.source === 'api') throw new Error('contact_limit_reached');
      },
    });
    await as.mutation(api.features.crm.mutations.createLead, { firstName: 'A', lastName: 'B' });
    await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        { firstName: 'C', lastName: 'D' },
        { firstName: 'E', lastName: 'F' },
      ],
    });
    const { key } = await as.mutation(api.features.api.mutations.createApiKey, {
      name: 'k',
      scopes: ['contacts:write'],
    });
    const refused = await t.fetch('/api/v1/contacts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'G', lastName: 'H', email: 'g@example.com' }),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'contact_limit_reached',
    );
    expect(calls).toEqual([
      { count: 1, source: 'crm' },
      { count: 2, source: 'import' },
      { count: 1, source: 'api' },
    ]);
    expect(await t.run((ctx) => ctx.db.query('leads').collect())).toHaveLength(3);
  });

  test('beforeWorkflowRun false skips the enrollment and keeps the lead write', async () => {
    const { t, as } = await setup();
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Bienvenue',
      trigger: { type: 'lead_created' },
      allowReEnrollment: false,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    setExtensionsForTests({
      beforeWorkflowRun: async (_ctx, workflow) => workflow._id !== workflowId,
    });
    await as.mutation(api.features.crm.mutations.createLead, { firstName: 'A', lastName: 'B' });
    await t.run(async (ctx) => {
      expect(await ctx.db.query('leads').collect()).toHaveLength(1);
      expect(await ctx.db.query('workflowRuns').collect()).toHaveLength(0);
    });
  });

  test('beforeSend refuses by throwing at creation, preparation, retry and resend', async () => {
    const { t, as } = await setup();
    // A Brevo key makes the email provider "configured" so createCampaign accepts.
    const savedKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'test-brevo-key';
    try {
      await as.mutation(api.features.crm.mutations.createLead, {
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
      });
      const seen: string[] = [];
      let allow = true;
      const refusal = { code: 'quota_exceeded', quota: 'emails', limit: 1, used: 1 };
      setExtensionsForTests({
        beforeSend: async (_ctx, info) => {
          seen.push(info.source === 'campaign' ? `${info.stage}:${info.count}` : 'workflow');
          if (!allow) throw new ConvexError(refusal);
        },
      });
      const create = () =>
        as.mutation(api.features.crm.mutations.createCampaign, {
          name: 'Newsletter',
          channel: 'email',
          filter: {},
          subject: 'Bonjour',
          htmlBody: '<p>Contenu</p>',
        });
      const prepare = async (
        campaignId: Awaited<ReturnType<typeof create>>,
        batchSize?: number,
      ) => {
        let cursor: string | undefined;
        for (;;) {
          const res = await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
            campaignId,
            filter: {},
            batchSize,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          if (res.isDone) return;
          cursor = res.continueCursor ?? undefined;
        }
      };

      // Refused at creation: the structured reason reaches the caller and nothing is written.
      allow = false;
      const error = await create().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConvexError);
      expect((error as ConvexError<typeof refusal>).data).toEqual(refusal);
      expect(await t.run((ctx) => ctx.db.query('campaigns').collect())).toHaveLength(0);

      // Refused once recipients are known: the campaign fails with the code and never drains.
      allow = true;
      const failed = await create();
      allow = false;
      await prepare(failed);
      expect(await t.run((ctx) => ctx.db.get(failed))).toMatchObject({
        status: 'failed',
        failureReason: 'quota_exceeded',
      });

      // Allowed through: then a retry and a resend go through the same gate.
      allow = true;
      const campaignId = await create();
      await prepare(campaignId);
      expect((await t.run((ctx) => ctx.db.get(campaignId)))?.status).toBe('sending');
      const send = (await t.run((ctx) => ctx.db.query('campaignSends').collect())).find(
        (row) => row.campaignId === campaignId,
      )!;
      await t.run(async (ctx) => {
        await ctx.db.patch(send._id, { status: 'failed' });
        await ctx.db.patch(campaignId, { status: 'sent', failedCount: 1 });
      });
      allow = false;
      await expect(
        as.mutation(api.features.crm.mutations.retryCampaignSend, { campaignId, sendId: send._id }),
      ).rejects.toThrow(/quota_exceeded/);
      await expect(
        as.mutation(api.features.crm.mutations.resendAllCampaignSends, { campaignId }),
      ).rejects.toThrow(/quota_exceeded/);
      // The refused retry rolled back: the send is still failed and the campaign still sent.
      expect((await t.run((ctx) => ctx.db.get(send._id)))?.status).toBe('failed');
      expect((await t.run((ctx) => ctx.db.get(campaignId)))?.status).toBe('sent');
      allow = true;
      await as.mutation(api.features.crm.mutations.retryCampaignSend, {
        campaignId,
        sendId: send._id,
      });
      expect((await t.run((ctx) => ctx.db.get(campaignId)))?.status).toBe('sending');

      expect(seen).toEqual([
        'create:1',
        'create:1',
        'prepared:1',
        'create:1',
        'prepared:1',
        'resend:1',
        'resend:1',
        'resend:1',
      ]);

      // Large campaigns are gated page by page with the running count: a refusal stops the
      // preparation within one page and never reaches the drain.
      for (const n of [2, 3, 4]) {
        await as.mutation(api.features.crm.mutations.createLead, {
          firstName: `L${n}`,
          lastName: 'Page',
          email: `l${n}@example.com`,
        });
      }
      seen.length = 0;
      setExtensionsForTests({
        beforeSend: async (_ctx, info) => {
          seen.push(info.source === 'campaign' ? `${info.stage}:${info.count}` : 'workflow');
          if (info.source === 'campaign' && info.stage !== 'create' && info.count > 2) {
            throw new Error('too_many');
          }
        },
      });
      const paged = await create();
      await prepare(paged, 1);
      expect(await t.run((ctx) => ctx.db.get(paged))).toMatchObject({
        status: 'failed',
        failureReason: 'too_many',
      });
      const written = (await t.run((ctx) => ctx.db.query('campaignSends').collect())).filter(
        (row) => row.campaignId === paged,
      );
      expect(written).toHaveLength(3);
      expect(seen).toEqual(['create:1', 'preparing:1', 'preparing:2', 'preparing:3']);
    } finally {
      if (savedKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = savedKey;
    }
  });

  test('beforeLeadCreate also gates a soft-deleted contact revived by the API upsert', async () => {
    const { t, as } = await setup();
    const deletedId = await seedLead(t, { email: 'gone@example.com', deletedAt: Date.now() });
    const { key } = await as.mutation(api.features.api.mutations.createApiKey, {
      name: 'k',
      scopes: ['contacts:write'],
    });
    const upsert = () =>
      t.fetch('/api/v1/contacts/upsert', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: 'Back', lastName: 'Again', email: 'gone@example.com' }),
      });
    const calls: string[] = [];
    setExtensionsForTests({
      beforeLeadCreate: async (_ctx, info) => {
        calls.push(info.source);
        throw new Error('contact_limit_reached');
      },
    });
    const refused = await upsert();
    expect(refused.status).toBe(400);
    expect((await t.run((ctx) => ctx.db.get(deletedId)))?.deletedAt).toBeDefined();

    setExtensionsForTests(null);
    expect((await upsert()).status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(deletedId)))?.deletedAt).toBeUndefined();
    expect(calls).toEqual(['api']);
  });

  test('beforeApiRequest answers instead of the route, after authentication', async () => {
    const { t, as } = await setup();
    const { key } = await as.mutation(api.features.api.mutations.createApiKey, {
      name: 'k',
      scopes: ['contacts:read'],
    });
    setExtensionsForTests({
      beforeApiRequest: async (_ctx, apiKey, method) => ({
        status: 402,
        code: 'quota_exceeded',
        message: `${method} refused for ${apiKey.name}`,
        details: { limit: 0 },
      }),
    });
    const refused = await t.fetch('/api/v1/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(refused.status).toBe(402);
    expect(await refused.json()).toEqual({
      error: { code: 'quota_exceeded', message: 'GET refused for k', details: { limit: 0 } },
    });
    // Unauthenticated callers never reach the hook.
    expect((await t.fetch('/api/v1/me', { method: 'GET' })).status).toBe(401);
  });

  test('registerHttpRoutes receives the router; the default registers nothing', () => {
    const registered: string[] = [];
    const router = { route: (spec: { path?: string }) => registered.push(spec.path ?? '') };
    extensions.registerHttpRoutes(router as unknown as HttpRouter);
    expect(registered).toEqual([]);
    setExtensionsForTests({
      registerHttpRoutes: (http) =>
        http.route({ path: '/ops/health', method: 'GET', handler: null as never }),
    });
    extensions.registerHttpRoutes(router as unknown as HttpRouter);
    expect(registered).toEqual(['/ops/health']);
  });

  test('beforeLeadCreate sees the real import delta: matches and invalid rows do not count', async () => {
    const { t, as } = await setup();
    await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Live',
      lastName: 'One',
      email: 'live@example.com',
    });
    await seedLead(t, { email: 'gone@example.com', deletedAt: Date.now() });
    const counts: number[] = [];
    setExtensionsForTests({
      beforeLeadCreate: async (_ctx, info) => {
        if (info.source === 'import') counts.push(info.count);
      },
    });
    const result = await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [
        // Matches a live lead: an update, not a new contact.
        { firstName: 'Live', lastName: 'Renamed', email: 'live@example.com' },
        // New contact.
        { firstName: 'New', lastName: 'One', email: 'new@example.com' },
        // Revives a soft-deleted lead: becomes live again.
        { firstName: 'Back', lastName: 'Again', email: 'gone@example.com' },
        // Invalid row: reported, never counted.
        {
          firstName: 'Bad',
          lastName: 'Address',
          email: 'bad@example.com',
          address: { country: 'zz', streetNumber: '', street: '', postalCode: '', city: '' },
        },
      ],
    });
    expect(counts).toEqual([2]);
    expect(result).toMatchObject({ created: 1, updated: 2 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].index).toBe(3);
    // Only updates: the gate is not even consulted.
    await as.mutation(api.features.crm.mutations.importLeads, {
      rows: [{ firstName: 'Live', lastName: 'Again', email: 'live@example.com' }],
    });
    expect(counts).toEqual([2]);
  });

  test('beforeScheduledWork false defers each background entry point untouched', async () => {
    const { t, as } = await setup();
    const savedKey = process.env.BREVO_API_KEY;
    process.env.BREVO_API_KEY = 'test-brevo-key';
    try {
      const scheduledLater = async (name: string) => {
        const rows = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
        return rows.filter(
          (row) =>
            row.name.includes(name) &&
            row.scheduledTime >= Date.now() + SCHEDULED_WORK_RETRY_MS - 5_000,
        );
      };
      const leadId = await as.mutation(api.features.crm.mutations.createLead, {
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
      });
      await t.run((ctx) => ctx.db.patch(leadId, { marketingConsent: ['email'] }));
      const campaignId = await as.mutation(api.features.crm.mutations.createCampaign, {
        name: 'Newsletter',
        channel: 'email',
        filter: {},
        subject: 'Bonjour',
        htmlBody: '<p>Contenu</p>',
      });
      const defer = (kinds: string[]) =>
        setExtensionsForTests({
          beforeScheduledWork: async (_ctx, { kind }) => !kinds.includes(kind),
        });

      // campaign_prepare: the page is rescheduled and no recipient is materialised.
      defer(['campaign_prepare']);
      const page = await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
        campaignId,
        filter: {},
      });
      expect(page).toEqual({ isDone: false, continueCursor: null });
      expect(await t.run((ctx) => ctx.db.get(campaignId))).toMatchObject({
        status: 'preparing',
        totalCount: 0,
      });
      expect(await scheduledLater('prepareCampaignBatch')).toHaveLength(1);

      // campaign_drain: pending sends wait, the campaign stays sending, the drain is rescheduled.
      setExtensionsForTests(null);
      await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
        campaignId,
        filter: {},
      });
      expect((await t.run((ctx) => ctx.db.get(campaignId)))?.status).toBe('sending');
      defer(['campaign_drain']);
      await t.action(internal.features.crm.actions.sendCampaignBatch, { campaignId });
      const sends = (await t.run((ctx) => ctx.db.query('campaignSends').collect())).filter(
        (row) => row.campaignId === campaignId,
      );
      expect(sends.map((row) => row.status)).toEqual(['pending']);
      expect((await t.run((ctx) => ctx.db.get(campaignId)))?.status).toBe('sending');
      expect(await scheduledLater('sendCampaignBatch')).toHaveLength(1);

      // workflow_step and workflow_action: the run stays parked on its node, the pending step waits.
      setExtensionsForTests(null);
      const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
        name: 'Bienvenue',
        trigger: { type: 'lead_created' },
        allowReEnrollment: false,
        nodes: [{ id: 'n1', type: 'send_email', subject: 'Hi', htmlBody: '<p>x</p>' }],
        startNodeId: 'n1',
      });
      await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
        workflowId,
        status: 'active',
      });
      const enrolledId = await as.mutation(api.features.crm.mutations.createLead, {
        firstName: 'C',
        lastName: 'D',
        email: 'c@example.com',
      });
      await t.run((ctx) => ctx.db.patch(enrolledId, { marketingConsent: ['email'] }));
      const run = (await t.run((ctx) => ctx.db.query('workflowRuns').collect())).find(
        (row) => row.leadId === enrolledId,
      )!;
      defer(['workflow_step']);
      await t.mutation(internal.features.workflows.internal.executeStep, {
        runId: run._id,
        nodeId: 'n1',
      });
      expect(await t.run((ctx) => ctx.db.get(run._id))).toMatchObject({
        currentNodeId: 'n1',
        stepCount: 0,
      });
      expect(await scheduledLater('executeStep')).toHaveLength(1);

      setExtensionsForTests(null);
      await t.mutation(internal.features.workflows.internal.executeStep, {
        runId: run._id,
        nodeId: 'n1',
      });
      const step = (await t.run((ctx) => ctx.db.query('workflowRunSteps').collect())).find(
        (row) => row.runId === run._id,
      )!;
      expect(step.status).toBe('pending');
      defer(['workflow_action']);
      await t.action(internal.features.workflows.actions.runWorkflowActionStep, {
        runId: run._id,
        stepId: step._id,
        nodeId: 'n1',
      });
      expect((await t.run((ctx) => ctx.db.get(step._id)))?.status).toBe('pending');
      expect(await scheduledLater('runWorkflowActionStep')).toHaveLength(1);
    } finally {
      if (savedKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = savedKey;
    }
  });
});
