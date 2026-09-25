import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

const NOW = Date.parse('2026-09-26T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const opened: T[] = [];
beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  jest.useFakeTimers();
  jest.setSystemTime(new Date(NOW));
});
afterEach(async () => {
  for (const t of opened.splice(0)) await settle(t);
  jest.useRealTimers();
});
/** Runs the scheduled work; the fake clock lands on the real time afterwards, so it goes back. */
async function settle(t: T, backTo = NOW) {
  await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  jest.setSystemTime(new Date(backTo));
}
const advance = (ms: number) => jest.setSystemTime(new Date(Date.now() + ms));

async function setup(tracking: { enabled?: boolean; mode?: 'anonymous' | 'named' } = {}) {
  const t = createTestConvex();
  opened.push(t);
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'WAP',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      tracking: {
        enabled: tracking.enabled ?? true,
        mode: tracking.mode ?? 'named',
        retentionDays: 90,
      },
      updatedAt: Date.now(),
    }),
  );
  return { t, as, emp };
}

const VISITOR = 'a'.repeat(32);
const beacon = (t: T, body: unknown, headers: Record<string, string> = {}) =>
  t.fetch('/track', { method: 'POST', body: JSON.stringify(body), headers });
const view = (path: string, at = Date.now()) => ({
  u: `https://www.example.fr${path}`,
  t: `Page ${path}`,
  r: 'https://www.google.fr/',
  at,
});
const views = (t: T) => t.run((ctx) => ctx.db.query('pageViews').collect());
const leadsOf = (t: T) => t.run((ctx) => ctx.db.query('leads').collect());

/** A capture form and a submission from a browser that carries the tracking cookie. */
async function submitForm(t: T, as: ReturnType<typeof asIdentity>, email: string) {
  const formId = await as.mutation(api.features.forms.mutations.createForm, {
    name: 'Contact',
    fields: [
      { target: { kind: 'standard', field: 'firstName' }, label: 'Prénom', required: true },
      { target: { kind: 'standard', field: 'email' }, label: 'E-mail', required: true },
    ],
    buttonText: 'Envoyer',
    afterSubmit: { kind: 'message', message: 'Merci' },
    consentText: 'OK',
    active: true,
  });
  const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
  const { ts, sig } = (await def.json()) as { ts: number; sig: string };
  advance(5_000);
  const res = await t.fetch(`/forms/${formId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      renderedAt: ts,
      renderSig: sig,
      trackingVisitor: VISITOR,
      values: { prenom: 'Ada', 'e-mail': email },
    }),
  });
  expect(res.status).toBe(200);
}

describe('web tracking', () => {
  test('the script carries the switch; a beacon is validated, bounded and rate-limited; Do Not Track is honoured', async () => {
    const { t } = await setup();
    const js = await t.fetch('/track.js', { method: 'GET' });
    expect(js.status).toBe(200);
    const script = await js.text();
    expect(script).toContain('"enabled":true');
    expect(script).toContain('doNotTrack');
    expect(script).toContain('wapTrack');

    expect((await beacon(t, { v: 'nope', e: [] })).status).toBe(400);
    expect((await beacon(t, 'garbage')).status).toBe(400);
    // Do Not Track: nothing stored, nothing said.
    expect((await beacon(t, { v: VISITOR, e: [view('/')] }, { dnt: '1' })).status).toBe(204);
    expect(await views(t)).toEqual([]);
    // A javascript: URL, a missing URL and a title too long: dropped or cut, the rest stored.
    const res = await beacon(t, {
      v: VISITOR,
      e: [
        view('/tarifs'),
        { u: 'javascript:alert(1)' },
        { t: 'sans url' },
        { ...view('/a'), t: 'x'.repeat(500) },
      ],
    });
    expect(res.status).toBe(204);
    const stored = await views(t);
    expect(stored.map((v) => v.path).sort()).toEqual(['/a', '/tarifs']);
    expect(stored.find((v) => v.path === '/a')?.title).toHaveLength(300);
    expect(stored.every((v) => v.leadId === undefined)).toBe(true);
    const visitor = await t.run((ctx) => ctx.db.query('webVisitors').first());
    expect(visitor).toMatchObject({ visitorId: VISITOR, views: 2 });

    // Per visitor: sixty a minute.
    let last = 204;
    for (let i = 0; i < 70 && last !== 429; i++) {
      last = (await beacon(t, { v: VISITOR, e: [view('/p')] })).status;
    }
    expect(last).toBe(429);

    const off = await setup({ enabled: false });
    expect(await (await off.t.fetch('/track.js', { method: 'GET' })).text()).toContain(
      '"enabled":false',
    );
    await beacon(off.t, { v: VISITOR, e: [view('/')] });
    expect(await views(off.t)).toEqual([]);
  });

  test('named mode: a form submission attaches the browser’s earlier views to the contact, later ones land directly, filters and scoring see them', async () => {
    const { t, as } = await setup({ mode: 'named' });
    await as.mutation(api.features.scoring.mutations.createScoringRule, {
      name: 'A vu les tarifs',
      criteria: {
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              {
                field: { kind: 'standard', field: 'visitedPages' },
                operator: 'contains',
                value: '/tarifs',
              },
            ],
          },
        ],
      },
      points: 20,
      active: true,
    });
    for (const path of ['/', '/tarifs', '/contact']) {
      await beacon(t, { v: VISITOR, e: [view(path)] });
      advance(60_000);
    }
    expect((await views(t)).every((v) => v.leadId === undefined)).toBe(true);

    await submitForm(t, as, 'ada@example.com');
    await settle(t, Date.now());
    const [lead] = await leadsOf(t);
    const attached = await views(t);
    expect(attached).toHaveLength(3);
    expect(attached.every((v) => v.leadId === lead._id)).toBe(true);
    expect(lead).toMatchObject({
      pageViewCount: 3,
      visitedPages: ['/', '/tarifs', '/contact'],
      leadScore: 20,
    });
    expect(lead.lastPageViewAt).toBe(Math.max(...attached.map((v) => v.at)));

    // The next view lands on the contact at once.
    advance(60_000);
    await beacon(t, { v: VISITOR, e: [view('/blog')] });
    const after = (await leadsOf(t))[0];
    expect(after.pageViewCount).toBe(4);
    expect(after.visitedPages).toEqual(['/', '/tarifs', '/contact', '/blog']);

    const timeline = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId: lead._id,
      kinds: ['page_view'],
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(timeline.page.map((e) => (e.kind === 'page_view' ? e.path : ''))).toEqual([
      '/blog',
      '/contact',
      '/tarifs',
      '/',
    ]);

    // The export carries the views, the erasure takes them with the browser.
    const { archive } = await as.action(api.features.rgpd.actions.exportContactData, {
      leadId: lead._id,
    });
    expect(archive.pageViews).toHaveLength(4);
    await as.mutation(api.features.rgpd.mutations.eraseContact, {
      leadId: lead._id,
      confirm: true,
    });
    await settle(t, Date.now());
    expect(await views(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('webVisitors').collect())).toEqual([]);
  });

  test('anonymous mode attaches nothing, and a contact who objected to profiling stays out in named mode', async () => {
    const anon = await setup({ mode: 'anonymous' });
    await beacon(anon.t, { v: VISITOR, e: [view('/tarifs')] });
    await submitForm(anon.t, anon.as, 'ada@example.com');
    await settle(anon.t, Date.now());
    const [lead] = await leadsOf(anon.t);
    expect(lead.pageViewCount).toBeUndefined();
    expect((await views(anon.t)).every((v) => v.leadId === undefined)).toBe(true);
    expect(
      (await anon.t.run((ctx) => ctx.db.query('webVisitors').first()))?.leadId,
    ).toBeUndefined();

    const named = await setup({ mode: 'named' });
    await beacon(named.t, { v: VISITOR, e: [view('/tarifs')] });
    await submitForm(named.t, named.as, 'bob@example.com');
    await settle(named.t, Date.now());
    const [bob] = await leadsOf(named.t);
    await named.as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: bob._id,
      exclude: true,
    });
    await beacon(named.t, { v: VISITOR, e: [view('/contact')] });
    const bobAfter = (await leadsOf(named.t))[0];
    expect(bobAfter.pageViewCount).toBe(1);
    expect(bobAfter.visitedPages).toEqual(['/tarifs']);
    // The objection detaches the browser: its later views are anonymous again.
    expect((await views(named.t)).filter((v) => v.leadId === undefined).map((v) => v.path)).toEqual(
      ['/contact'],
    );
  });

  test('a tracked link identifies the browser that lands from it, in named mode only', async () => {
    const { t, as } = await setup({ mode: 'named' });
    const ada = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    const token = await t.run(async (ctx) => {
      const campaignId = await ctx.db.insert('campaigns', {
        name: 'Offre',
        channel: 'email',
        messageType: 'marketing',
        subject: 'Offre',
        htmlBody: '<p>x</p>',
        status: 'sent',
        totalCount: 1,
        sentCount: 1,
        failedCount: 0,
        updatedAt: Date.now(),
        trackedLinks: [
          {
            key: 'cta',
            label: 'Tarifs',
            target: { kind: 'standard', field: 'comment' },
            value: 'intéressé',
            redirectUrl: 'https://www.example.fr/tarifs?utm=x',
          },
        ],
      });
      const sendId = await ctx.db.insert('campaignSends', {
        campaignId,
        leadId: ada,
        email: 'ada@example.com',
        params: {},
        status: 'sent',
      });
      await ctx.db.insert('campaignLinkTokens', {
        token: 'tok-ada',
        campaignId,
        sendId,
        leadId: ada,
        linkKey: 'cta',
      });
      return 'tok-ada';
    });
    await beacon(t, { v: VISITOR, e: [view('/')] });
    const click = await t.fetch(`/l/${token}`, { method: 'GET' });
    expect(click.status).toBe(302);
    expect(click.headers.get('Location')).toBe('https://www.example.fr/tarifs?utm=x&wapl=tok-ada');
    // The landing page's script reads the parameter and sends it with the view.
    await beacon(t, { v: VISITOR, e: [view('/tarifs')], l: token });
    await settle(t, Date.now());
    const lead = await t.run((ctx) => ctx.db.get(ada));
    expect(lead).toMatchObject({ pageViewCount: 2, visitedPages: ['/', '/tarifs'] });
    expect((await views(t)).every((v) => v.leadId === ada)).toBe(true);

    // Anonymous mode: the link redirects without the parameter and a token in a beacon ties nothing.
    const anon = await setup({ mode: 'anonymous' });
    const bob = await anon.as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'M',
      email: 'bob@example.com',
    });
    await anon.t.run(async (ctx) => {
      const campaignId = await ctx.db.insert('campaigns', {
        name: 'C',
        channel: 'email',
        messageType: 'marketing',
        subject: 'C',
        htmlBody: 'x',
        status: 'sent',
        totalCount: 1,
        sentCount: 1,
        failedCount: 0,
        updatedAt: Date.now(),
        trackedLinks: [
          {
            key: 'k',
            label: 'L',
            target: { kind: 'standard', field: 'comment' },
            value: 'v',
            redirectUrl: 'https://www.example.fr/',
          },
        ],
      });
      const sendId = await ctx.db.insert('campaignSends', {
        campaignId,
        leadId: bob,
        email: 'bob@example.com',
        params: {},
        status: 'sent',
      });
      await ctx.db.insert('campaignLinkTokens', {
        token: 'tok-bob',
        campaignId,
        sendId,
        leadId: bob,
        linkKey: 'k',
      });
    });
    expect((await anon.t.fetch('/l/tok-bob', { method: 'GET' })).headers.get('Location')).toBe(
      'https://www.example.fr/',
    );
    await beacon(anon.t, { v: VISITOR, e: [view('/')], l: 'tok-bob' });
    await settle(anon.t, Date.now());
    expect((await anon.t.run((ctx) => ctx.db.get(bob)))?.pageViewCount).toBeUndefined();
  });

  test('the purge drops the views and the idle browsers past the tracking retention, the settings bound it', async () => {
    const { t, as } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('pageViews', {
        visitorId: VISITOR,
        url: 'https://www.example.fr/old',
        path: '/old',
        at: NOW - 91 * DAY,
      });
      await ctx.db.insert('pageViews', {
        visitorId: VISITOR,
        url: 'https://www.example.fr/new',
        path: '/new',
        at: NOW - 89 * DAY,
      });
      await ctx.db.insert('webVisitors', {
        visitorId: 'b'.repeat(32),
        firstSeenAt: NOW - 200 * DAY,
        lastSeenAt: NOW - 100 * DAY,
        views: 1,
      });
      await ctx.db.insert('webVisitors', {
        visitorId: VISITOR,
        firstSeenAt: NOW - 200 * DAY,
        lastSeenAt: NOW - 89 * DAY,
        views: 2,
      });
    });
    await t.mutation(internal.features.retention.internal.runPurge, {});
    await settle(t);
    expect((await views(t)).map((v) => v.path)).toEqual(['/new']);
    expect(
      (await t.run((ctx) => ctx.db.query('webVisitors').collect())).map((v) => v.visitorId),
    ).toEqual([VISITOR]);

    await expect(
      as.mutation(api.features.config.mutations.updateConfig, { trackingRetentionDays: 3 }),
    ).rejects.toThrow(/tracking_retention_out_of_bounds/);
    await as.mutation(api.features.config.mutations.updateConfig, {
      trackingRetentionDays: 30,
      trackingMode: 'anonymous',
    });
    const settings = await as.query(api.features.tracking.queries.getTrackingSettings, {});
    expect(settings).toMatchObject({
      enabled: true,
      mode: 'anonymous',
      retentionDays: 30,
      visitors: 1,
    });
  });
});
