import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { evalRule } from '../../convex/features/crm/leadMatching';
import {
  asIdentity,
  createTestConvex,
  seedEmployee,
  type T,
  seedConfig,
  pinClock,
  runAll,
} from './helpers';

const NOW = Date.parse('2026-09-26T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const SITE = 'https://www.example.fr';
beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  pinClock(NOW);
});
// Running timers moves the date: it goes back, for the seeded sessions.
const settle = (t: T, backTo = NOW) => runAll(t, backTo);
const advance = (ms: number) => jest.setSystemTime(new Date(Date.now() + ms));

async function setup(tracking: { enabled?: boolean; mode?: 'anonymous' | 'named' } = {}) {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await seedConfig(t, {
    tracking: {
      enabled: tracking.enabled ?? true,
      mode: tracking.mode ?? 'named',
      retentionDays: 90,
      allowedOrigins: [SITE],
      privacyUrl: `${SITE}/confidentialite`,
    },
  });
  return { t, as, emp };
}

const VISITOR = 'a'.repeat(32);
const OTHER = 'c'.repeat(32);
const beacon = (t: T, body: unknown, headers: Record<string, string> = {}) =>
  t.fetch('/track', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { Origin: SITE, ...headers },
  });
const view = (path: string, at = Date.now()) => ({
  u: `${SITE}${path}`,
  t: `Page ${path}`,
  r: 'https://www.google.fr/',
  at,
});
const views = (t: T) => t.run((ctx) => ctx.db.query('pageViews').collect());
const visitors = (t: T) => t.run((ctx) => ctx.db.query('webVisitors').collect());
const leadsOf = (t: T) => t.run((ctx) => ctx.db.query('leads').collect());
const leadOf = async (t: T, id: Id<'leads'>) => (await t.run((ctx) => ctx.db.get(id)))!;

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

/** A sent campaign with one tracked link per redirect URL, and the contact's token for each. */
async function trackedLinks(t: T, leadId: Id<'leads'>, redirects: Record<string, string>) {
  await t.run(async (ctx) => {
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
      trackedLinks: Object.entries(redirects).map(([key, redirectUrl]) => ({
        key,
        label: key,
        target: { kind: 'standard' as const, field: 'comment' as const },
        value: 'intéressé',
        redirectUrl,
      })),
    });
    const sendId = await ctx.db.insert('campaignSends', {
      campaignId,
      leadId,
      email: 'ada@example.com',
      params: {},
      status: 'sent',
    });
    for (const key of Object.keys(redirects)) {
      await ctx.db.insert('campaignLinkTokens', {
        token: `tok-${key}`,
        campaignId,
        sendId,
        leadId,
        linkKey: key,
      });
    }
  });
}

/** A click on a tracked link: where it lands, and the one-time value the landing URL carries, if any. */
async function click(t: T, key: string) {
  const res = await t.fetch(`/l/tok-${key}`, { method: 'GET' });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location') ?? '');
  return { location, grant: location.searchParams.get('wapl') };
}

/** A contact with a browser and views already attached, as named tracking leaves them. */
async function tracked(t: T, leadId: Id<'leads'>, visitorId: string, paths: string[], at = NOW) {
  await t.run(async (ctx) => {
    await ctx.db.insert('webVisitors', {
      visitorId,
      leadId,
      firstSeenAt: at,
      lastSeenAt: at,
      views: paths.length,
    });
    for (const [i, path] of paths.entries()) {
      await ctx.db.insert('pageViews', {
        visitorId,
        leadId,
        url: `${SITE}${path}`,
        path,
        at: at + i,
      });
    }
    await ctx.db.patch(leadId, {
      pageViewCount: paths.length,
      lastPageViewAt: at + paths.length - 1,
      visitedPages: [...new Set(paths)],
    });
  });
}

describe('web tracking', () => {
  test('the script carries the settings; a beacon is validated, bounded and rate-limited; privacy signals are honoured', async () => {
    const { t } = await setup();
    const js = await t.fetch('/track.js', { method: 'GET' });
    expect(js.status).toBe(200);
    const script = await js.text();
    expect(script).toContain('"enabled":true');
    expect(script).toContain('"mode":"named"');
    expect(script).toContain(`"privacyUrl":"${SITE}/confidentialite"`);
    expect(script).toContain('globalPrivacyControl');

    expect((await beacon(t, { v: 'nope', e: [] })).status).toBe(400);
    expect((await beacon(t, 'garbage')).status).toBe(400);
    // Global Privacy Control, Do Not Track: nothing stored, nothing said.
    expect((await beacon(t, { v: VISITOR, e: [view('/')] }, { dnt: '1' })).status).toBe(204);
    expect((await beacon(t, { v: VISITOR, e: [view('/')] }, { 'sec-gpc': '1' })).status).toBe(204);
    // A site the script was not set up for, or no site at all.
    expect(
      (await beacon(t, { v: VISITOR, e: [view('/')] }, { Origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect(
      (
        await t.fetch('/track', {
          method: 'POST',
          body: JSON.stringify({ v: VISITOR, e: [view('/')] }),
        })
      ).status,
    ).toBe(403);
    // A body past the cap is not read.
    expect((await beacon(t, { v: VISITOR, e: [view(`/${'x'.repeat(70_000)}`)] })).status).toBe(413);
    expect(await views(t)).toEqual([]);
    // A javascript: URL, a missing URL, another site's page: dropped; a title too long: cut; the link value never stored.
    const res = await beacon(t, {
      v: VISITOR,
      e: [
        view('/tarifs?wapl=abc&utm=x'),
        { u: 'javascript:alert(1)' },
        { t: 'sans url' },
        { u: 'https://evil.example/page' },
        { ...view('/a'), t: 'x'.repeat(500) },
      ],
    });
    expect(res.status).toBe(204);
    const stored = await views(t);
    expect(stored.map((v) => v.path).sort()).toEqual(['/a', '/tarifs']);
    expect(stored.find((v) => v.path === '/tarifs')?.url).toBe(`${SITE}/tarifs?utm=x`);
    expect(stored.find((v) => v.path === '/a')?.title).toHaveLength(300);
    expect(stored.every((v) => v.leadId === undefined)).toBe(true);
    expect((await visitors(t))[0]).toMatchObject({ visitorId: VISITOR, views: 2 });

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

  test('the whole deployment has a ceiling, counted in views, whatever the browsers', async () => {
    const { t, as } = await setup();
    const twenty = Array.from({ length: 20 }, (_, i) => view(`/p${i}`));
    const hex = (i: number) => i.toString(16).padStart(32, '0');
    // Six hundred views a minute: thirty full beacons from thirty browsers and addresses.
    for (let i = 0; i < 30; i++) {
      const res = await beacon(t, { v: hex(i), e: twenty }, { 'x-forwarded-for': `10.0.0.${i}` });
      expect(res.status).toBe(204);
    }
    const over = () => beacon(t, { v: hex(99), e: twenty }, { 'x-forwarded-for': '10.0.1.1' });
    expect((await over()).status).toBe(429);
    expect(await views(t)).toHaveLength(600);
    // The settings page learns that views were lost: the date, written once an hour at most.
    const noted = () =>
      as.query(api.features.tracking.queries.getTrackingSettings, {}).then((s) => s.ceilingHitAt);
    expect(await noted()).toBe(NOW);
    advance(1_000);
    expect((await over()).status).toBe(429);
    expect(await noted()).toBe(NOW);
    // Saving the settings keeps it.
    await as.mutation(api.features.config.mutations.updateConfig, { trackingRetentionDays: 30 });
    expect(await noted()).toBe(NOW);
  });

  test('named mode: a form submission attaches the browser’s earlier views to the contact, later ones follow within a minute, filters and scoring see them', async () => {
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

    // The next views are the contact's at once; the contact itself is written once for the lot.
    advance(60_000);
    await beacon(t, { v: VISITOR, e: [view('/blog')] });
    await beacon(t, { v: VISITOR, e: [view('/blog/article')] });
    expect((await views(t)).every((v) => v.leadId === lead._id)).toBe(true);
    expect((await leadsOf(t))[0].pageViewCount).toBe(3);
    expect((await visitors(t))[0].pending).toMatchObject({ count: 2 });
    await settle(t, Date.now());
    const after = (await leadsOf(t))[0];
    expect(after.pageViewCount).toBe(5);
    expect(after.visitedPages).toEqual(['/', '/tarifs', '/contact', '/blog', '/blog/article']);
    expect((await visitors(t))[0].pending).toBeUndefined();

    const timeline = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId: lead._id,
      kinds: ['page_view'],
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(timeline.page.map((e) => (e.kind === 'page_view' ? e.path : ''))).toEqual([
      '/blog/article',
      '/blog',
      '/contact',
      '/tarifs',
      '/',
    ]);

    // The export carries the views, the erasure takes them with the browser.
    const { archive } = await as.action(api.features.rgpd.actions.exportContactData, {
      leadId: lead._id,
    });
    expect(archive.pageViews).toHaveLength(5);
    await as.mutation(api.features.rgpd.mutations.eraseContact, {
      leadId: lead._id,
      confirm: true,
    });
    await settle(t, Date.now());
    expect(await views(t)).toEqual([]);
    expect(await visitors(t)).toEqual([]);
  });

  test('anonymous mode attaches nothing', async () => {
    const { t, as } = await setup({ mode: 'anonymous' });
    await beacon(t, { v: VISITOR, e: [view('/tarifs')] });
    await submitForm(t, as, 'ada@example.com');
    await settle(t, Date.now());
    const [lead] = await leadsOf(t);
    expect(lead.pageViewCount).toBeUndefined();
    expect((await views(t)).every((v) => v.leadId === undefined)).toBe(true);
    expect((await visitors(t))[0].leadId).toBeUndefined();
  });

  test('an objection to profiling detaches the browsers and the views at once, and nothing comes back', async () => {
    const { t, as } = await setup({ mode: 'named' });
    await beacon(t, { v: VISITOR, e: [view('/tarifs')] });
    await submitForm(t, as, 'bob@example.com');
    await settle(t, Date.now());
    const [bob] = await leadsOf(t);
    expect(bob).toMatchObject({ pageViewCount: 1, visitedPages: ['/tarifs'] });

    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: bob._id,
      exclude: true,
    });
    // No beacon needed, no scheduled step for a contact this size.
    const objected = await leadOf(t, bob._id);
    expect(objected.pageViewCount).toBeUndefined();
    expect(objected.lastPageViewAt).toBeUndefined();
    expect(objected.visitedPages).toBeUndefined();
    expect((await views(t)).map((v) => v.leadId)).toEqual([undefined]);
    expect((await visitors(t))[0].leadId).toBeUndefined();
    const { archive } = await as.action(api.features.rgpd.actions.exportContactData, {
      leadId: bob._id,
    });
    expect(archive.pageViews).toEqual([]);

    // Later views stay anonymous, and another form does not tie the browser again.
    await beacon(t, { v: VISITOR, e: [view('/contact')] });
    await t.mutation(internal.features.tracking.internal.identifyVisitor, {
      visitorId: VISITOR,
      leadId: bob._id,
    });
    await settle(t, Date.now());
    expect((await views(t)).every((v) => v.leadId === undefined)).toBe(true);
    expect((await leadOf(t, bob._id)).pageViewCount).toBeUndefined();

    // A contact with more views than a batch: the rest follows in scheduled steps.
    const big = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Big',
      lastName: 'Browser',
      email: 'big@example.com',
    });
    await tracked(
      t,
      big,
      OTHER,
      Array.from({ length: 450 }, (_, i) => `/p${i}`),
    );
    await as.mutation(api.features.rgpd.mutations.setProfilingExclusion, {
      leadId: big,
      exclude: true,
    });
    await settle(t, Date.now());
    expect((await views(t)).filter((v) => v.leadId !== undefined)).toEqual([]);
  });

  test('a tracked link identifies the browser that lands from it: once, for a short while, on a tracked site, in named mode', async () => {
    const { t, as } = await setup({ mode: 'named' });
    const ada = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await trackedLinks(t, ada, {
      cta: `${SITE}/tarifs?utm=x`,
      partner: 'https://partner.example/offre',
    });
    await beacon(t, { v: VISITOR, e: [view('/')] });

    // The landing URL carries a one-time value, never the link's own token.
    const { location, grant } = await click(t, 'cta');
    expect(location.origin + location.pathname).toBe(`${SITE}/tarifs`);
    expect(location.searchParams.get('utm')).toBe('x');
    expect(grant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.toString()).not.toContain('tok-cta');
    // A link that leaves the tracked sites carries nothing to a third party.
    expect((await click(t, 'partner')).location.toString()).toBe('https://partner.example/offre');

    await beacon(t, { v: VISITOR, e: [view('/tarifs')], l: grant });
    await settle(t, Date.now());
    expect(await leadOf(t, ada)).toMatchObject({
      pageViewCount: 2,
      visitedPages: ['/', '/tarifs'],
    });
    expect((await views(t)).every((v) => v.leadId === ada)).toBe(true);

    // The same URL, copied or shared: the value is spent.
    await beacon(t, { v: OTHER, e: [view('/tarifs')], l: grant });
    await settle(t, Date.now());
    expect((await visitors(t)).find((v) => v.visitorId === OTHER)?.leadId).toBeUndefined();

    // A value redeemed too long after the click: nothing.
    const late = await click(t, 'cta');
    advance(11 * 60_000);
    expect((await beacon(t, { v: OTHER, e: [view('/tarifs')], l: late.grant })).status).toBe(204);
    await settle(t, Date.now());
    expect((await visitors(t)).filter((v) => v.leadId !== undefined)).toHaveLength(1);
    expect((await leadOf(t, ada)).pageViewCount).toBe(2);

    // Anonymous mode: the link redirects without the parameter.
    const anon = await setup({ mode: 'anonymous' });
    const bob = await anon.as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'M',
      email: 'bob@example.com',
    });
    await trackedLinks(anon.t, bob, { cta: `${SITE}/` });
    expect((await click(anon.t, 'cta')).location.toString()).toBe(`${SITE}/`);
  });

  test('a merge moves the absorbed contact’s views and browsers to the survivor, marks included; an objection detaches both', async () => {
    const { t, as } = await setup({ mode: 'named' });
    const lead = (firstName: string, email: string) =>
      as.mutation(api.features.crm.mutations.createLead, { firstName, lastName: 'Curie', email });
    const survivorId = await lead('Marie', 'marie@example.com');
    const absorbedId = await lead('M.', 'm.curie@example.com');
    await tracked(t, survivorId, VISITOR, ['/', '/tarifs'], NOW - DAY);
    await tracked(t, absorbedId, OTHER, ['/tarifs', '/contact'], NOW);

    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId,
      absorbedId,
      fields: {},
    });
    await settle(t);
    expect((await views(t)).every((v) => v.leadId === survivorId)).toBe(true);
    expect((await visitors(t)).every((v) => v.leadId === survivorId)).toBe(true);
    expect(await leadOf(t, survivorId)).toMatchObject({
      pageViewCount: 4,
      lastPageViewAt: NOW + 1,
      visitedPages: ['/', '/tarifs', '/contact'],
    });
    const { archive } = await as.action(api.features.rgpd.actions.exportContactData, {
      leadId: survivorId,
    });
    expect(archive.pageViews).toHaveLength(4);

    // The absorbed contact had objected: the objection follows the person, tracking stops for both records.
    const objectorId = await lead('Marie S.', 'marie.s@example.com');
    await t.run((ctx) => ctx.db.patch(objectorId, { excludeFromProfiling: true }));
    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId,
      absorbedId: objectorId,
      fields: {},
    });
    await settle(t);
    expect((await views(t)).filter((v) => v.leadId !== undefined)).toEqual([]);
    expect((await visitors(t)).filter((v) => v.leadId !== undefined)).toEqual([]);
    const merged = await leadOf(t, survivorId);
    expect(merged.excludeFromProfiling).toBe(true);
    expect(merged.pageViewCount).toBeUndefined();
    expect(merged.visitedPages).toBeUndefined();
  });

  test('leaving named mode detaches everything; going back to it starts from nothing', async () => {
    const { t, as } = await setup({ mode: 'named' });
    const ada = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    });
    await tracked(
      t,
      ada,
      VISITOR,
      Array.from({ length: 250 }, (_, i) => `/p${i}`),
    );
    // A contact whose views went with a purge, its marks not yet rebuilt.
    const bob = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'M',
      email: 'bob@example.com',
    });
    await t.run((ctx) =>
      ctx.db.patch(bob, { pageViewCount: 3, lastPageViewAt: NOW, visitedPages: ['/tarifs'] }),
    );
    await as.mutation(api.features.config.mutations.updateConfig, { trackingMode: 'anonymous' });
    await settle(t);
    expect((await views(t)).filter((v) => v.leadId !== undefined)).toEqual([]);
    expect((await visitors(t))[0].leadId).toBeUndefined();
    for (const id of [ada, bob]) {
      const lead = await leadOf(t, id);
      expect(lead.visitedPages).toBeUndefined();
      expect(lead.pageViewCount).toBeUndefined();
      expect(lead.lastPageViewAt).toBeUndefined();
    }

    await as.mutation(api.features.config.mutations.updateConfig, { trackingMode: 'named' });
    await beacon(t, { v: VISITOR, e: [view('/tarifs')] });
    await settle(t);
    expect((await views(t)).filter((v) => v.leadId !== undefined)).toEqual([]);
    expect((await leadOf(t, ada)).pageViewCount).toBeUndefined();
  });

  test('the purge drops the views and the idle browsers past the retention, each under its own count, and the contact’s marks follow', async () => {
    const { t, as } = await setup();
    const lead = (firstName: string) =>
      as.mutation(api.features.crm.mutations.createLead, {
        firstName,
        lastName: 'Lovelace',
        email: `${firstName}@example.com`,
      });
    const ada = await lead('ada');
    const bob = await lead('bob');
    await t.run(async (ctx) => {
      const insert = (leadId: Id<'leads'> | undefined, path: string, at: number) =>
        ctx.db.insert('pageViews', {
          visitorId: VISITOR,
          leadId,
          url: `${SITE}${path}`,
          path,
          at,
        });
      await insert(undefined, '/old', NOW - 91 * DAY);
      await insert(undefined, '/new', NOW - 89 * DAY);
      await insert(ada, '/tarifs', NOW - 100 * DAY);
      await insert(ada, '/contact', NOW - 10 * DAY);
      await insert(bob, '/tarifs', NOW - 100 * DAY);
      const marks = { pageViewCount: 2, lastPageViewAt: NOW - 10 * DAY };
      await ctx.db.patch(ada, { ...marks, visitedPages: ['/tarifs', '/contact'] });
      await ctx.db.patch(bob, {
        pageViewCount: 1,
        lastPageViewAt: NOW - 100 * DAY,
        visitedPages: ['/tarifs'],
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
    expect((await views(t)).map((v) => v.path).sort()).toEqual(['/contact', '/new']);
    expect((await visitors(t)).map((v) => v.visitorId)).toEqual([VISITOR]);
    const report = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .collect()
        .then((rows) => rows.find((row) => row.entityType === 'retention')),
    );
    expect(report?.metadata.counts).toMatchObject({ pageViews: 3, webVisitors: 1 });
    // « A visité /tarifs » stops matching once the view is gone.
    expect(await leadOf(t, ada)).toMatchObject({
      pageViewCount: 1,
      lastPageViewAt: NOW - 10 * DAY,
      visitedPages: ['/contact'],
    });
    const gone = await leadOf(t, bob);
    expect(gone.pageViewCount).toBeUndefined();
    expect(gone.visitedPages).toBeUndefined();
  });

  test('the settings are bounded: a duration, the tracked sites, a privacy policy for named mode', async () => {
    const { t, as } = await setup();
    const update = (args: Record<string, unknown>) =>
      as.mutation(api.features.config.mutations.updateConfig, args);
    await expect(update({ trackingRetentionDays: 3 })).rejects.toThrow(
      /tracking_retention_out_of_bounds/,
    );
    await expect(update({ trackingAllowedOrigins: [] })).rejects.toThrow(
      /tracking_origins_required/,
    );
    await expect(update({ trackingAllowedOrigins: ['ftp://example.fr'] })).rejects.toThrow(
      /tracking_origins_invalid/,
    );
    await expect(update({ trackingPrivacyUrl: null })).rejects.toThrow(
      /tracking_privacy_url_required/,
    );
    await expect(update({ trackingPrivacyUrl: 'http://example.fr/p' })).rejects.toThrow(
      /tracking_privacy_url_invalid/,
    );
    await update({
      trackingRetentionDays: 30,
      trackingMode: 'anonymous',
      trackingPrivacyUrl: null,
      trackingAllowedOrigins: ['https://Example.fr/accueil?x=1', SITE, SITE],
    });
    await settle(t);
    expect(await as.query(api.features.tracking.queries.getTrackingSettings, {})).toEqual({
      enabled: true,
      mode: 'anonymous',
      retentionDays: 30,
      allowedOrigins: ['https://example.fr', SITE],
    });
    await beacon(t, { v: VISITOR, e: [view('/')] });
    expect(await as.query(api.features.tracking.queries.getTrackingCounts, {})).toEqual({
      visitors: 1,
      visitorsCapped: false,
      identified: 0,
      identifiedCapped: false,
    });
  });

  test('« pages visitées » is asked of each path: contains a text, equals a path', () => {
    const lead = { visitedPages: ['/', '/tarifs', '/blog/article'] } as Doc<'leads'>;
    const rule = (operator: 'contains' | 'equals' | 'isEmpty', value?: string) =>
      evalRule(lead, { field: { kind: 'standard', field: 'visitedPages' }, operator, value });
    expect(rule('contains', '/blog')).toBe(true);
    expect(rule('contains', '/prix')).toBe(false);
    expect(rule('equals', '/tarifs')).toBe(true);
    expect(rule('equals', '/blog')).toBe(false);
    expect(rule('isEmpty')).toBe(false);
    expect(
      evalRule({} as Doc<'leads'>, {
        field: { kind: 'standard', field: 'visitedPages' },
        operator: 'isEmpty',
      }),
    ).toBe(true);
  });
});
