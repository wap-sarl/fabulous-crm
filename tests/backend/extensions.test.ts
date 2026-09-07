import { afterEach, describe, expect, test } from 'bun:test';
import type { HttpRouter } from 'convex/server';
import { api, internal } from '../../convex/_generated/api';
import { extensions, setExtensionsForTests } from '../../convex/extensions';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

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

  test('beforeSend false fails a campaign at the end of its preparation', async () => {
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
      const seen: { channel: string; count: number; source: string }[] = [];
      setExtensionsForTests({
        beforeSend: async (_ctx, info) => {
          seen.push(info);
          return false;
        },
      });
      const campaignId = await as.mutation(api.features.crm.mutations.createCampaign, {
        name: 'Refusée',
        channel: 'email',
        filter: {},
        subject: 'Bonjour',
        htmlBody: '<p>Contenu</p>',
      });
      let cursor: string | undefined;
      for (;;) {
        const res = await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
          campaignId,
          filter: {},
          ...(cursor !== undefined ? { cursor } : {}),
        });
        if (res.isDone) break;
        cursor = res.continueCursor ?? undefined;
      }
      const campaign = await t.run((ctx) => ctx.db.get(campaignId));
      expect(campaign?.status).toBe('failed');
      expect(seen).toEqual([{ channel: 'email', count: 1, source: 'campaign' }]);
    } finally {
      if (savedKey === undefined) delete process.env.BREVO_API_KEY;
      else process.env.BREVO_API_KEY = savedKey;
    }
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
});
