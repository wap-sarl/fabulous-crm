import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { LandingSection } from '../../convex/_lib/validators/landingPages';
import { DAY_MS } from '../../convex/_lib/time';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 9, 10, 0, 0);
const SITE = 'https://crm-123.convex.site';
const advance = (ms: number) => setSystemTime(new Date(Date.now() + ms));

type As = ReturnType<typeof asIdentity>;

beforeEach(() => {
  pinClock(NOW);
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  process.env.CONVEX_SITE_URL = SITE;
});

async function setup(tracking = false) {
  const t = createTestConvex();
  // The clock moves by a day: the session must outlive it.
  const emp = await seedEmployee(t, {
    email: 'agent@example.com',
    role: 'admin',
    sessionTtlMs: 3 * DAY_MS,
  });
  const as = asIdentity(t, emp.identity);
  await seedConfig(
    t,
    tracking
      ? { tracking: { enabled: true, mode: 'anonymous', retentionDays: 90, allowedOrigins: [] } }
      : {},
  );
  return { t, as };
}

const createForm = (as: As, active = true) =>
  as.mutation(api.features.forms.mutations.createForm, {
    name: 'Démo',
    fields: [
      { target: { kind: 'standard', field: 'email' }, label: 'E-mail', required: true },
      { target: { kind: 'standard', field: 'firstName' }, label: 'Prénom', required: false },
    ],
    buttonText: 'Envoyer',
    afterSubmit: { kind: 'message', message: 'Merci !' },
    consentText: 'J’accepte.',
    active,
  });

const demoSections = (formId: Id<'forms'>): LandingSection[] => [
  {
    id: 'hero',
    type: 'hero',
    heading: 'Demandez une <démo>',
    text: 'Trente minutes & un café.',
    ctaLabel: 'Je demande',
    ctaHref: '#form',
  },
  { id: 'why', type: 'text', html: '<p>Trois raisons <strong>fortes</strong>.</p>' },
  { id: 'form', type: 'form', formId, heading: 'Vos coordonnées' },
];

const createPage = (as: As, sections: LandingSection[], slug = 'demo', name = 'Demande de démo') =>
  as.mutation(api.features.landingPages.mutations.createLandingPage, {
    name,
    slug,
    seo: { title: 'Demande de démo', description: 'Une démo de trente minutes.' },
    sections,
  });

const publish = (as: As, pageId: Id<'landingPages'>, status: 'draft' | 'published' = 'published') =>
  as.mutation(api.features.landingPages.mutations.setLandingPageStatus, { pageId, status });

const open = (t: T, slug: string, userAgent = 'Mozilla/5.0 (test)') =>
  t.fetch(`/p/${slug}`, { method: 'GET', headers: { 'user-agent': userAgent } });

const stats = (as: As, pageId: Id<'landingPages'>) =>
  as.query(api.features.landingPages.queries.getLandingPageStats, { pageId });

/** A submission as the embed sends it, with the page it says it is on. */
async function submitFrom(t: T, formId: Id<'forms'>, page: string | undefined, email: string) {
  const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
  const { ts, sig } = (await def.json()) as { ts: number; sig: string };
  advance(5_000);
  return t.fetch(`/forms/${formId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      renderedAt: ts,
      renderSig: sig,
      values: { 'e-mail': email, prenom: 'Ada' },
      page,
    }),
  });
}

describe('landing pages: slug and status rules', () => {
  test('a slug is lower-case letters, digits and hyphens, and names one live page; a deleted page frees it', async () => {
    const { t, as } = await setup();
    const formId = await createForm(as);
    await expect(createPage(as, demoSections(formId), 'Démo')).rejects.toMatchObject({
      data: { code: 'page_invalid_slug' },
    });
    await expect(createPage(as, demoSections(formId), '-demo')).rejects.toMatchObject({
      data: { code: 'page_invalid_slug' },
    });
    const pageId = await createPage(as, demoSections(formId));
    await expect(createPage(as, [], 'demo', 'Autre')).rejects.toMatchObject({
      data: { code: 'page_slug_taken' },
    });
    const other = await createPage(as, [], 'autre', 'Autre');
    await expect(
      as.mutation(api.features.landingPages.mutations.updateLandingPage, {
        pageId: other,
        name: 'Autre',
        slug: 'demo',
        seo: { title: 'Autre' },
        sections: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'page_slug_taken' } });

    await as.mutation(api.features.landingPages.mutations.deleteLandingPage, { pageId });
    expect(await as.query(api.features.landingPages.queries.getLandingPage, { pageId })).toBeNull();
    const again = await createPage(as, demoSections(formId));
    expect(again).not.toBe(pageId);
    const listed = await as.query(api.features.landingPages.queries.listLandingPages, {});
    expect(listed.map((p) => p.slug).sort()).toEqual(['autre', 'demo']);
    const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    expect(audits.filter((a) => a.entityType === 'landingPage').map((a) => a.action)).toEqual([
      'create',
      'create',
      'delete',
      'create',
    ]);
  });

  test('a page is validated: a heading, a button’s address, a form that exists; publishing needs something to show and a form where a button leads to one', async () => {
    const { t, as } = await setup();
    const formId = await createForm(as);
    const bad = (sections: LandingSection[], code: string) =>
      expect(createPage(as, sections, `p-${code.replaceAll('_', '-')}`)).rejects.toMatchObject({
        data: { code },
      });
    await bad([{ id: 'h', type: 'hero', heading: ' ' }], 'page_heading_required');
    await bad(
      [{ id: 'h', type: 'hero', heading: 'Hey', ctaLabel: 'Go', ctaHref: 'javascript:x' }],
      'page_invalid_url',
    );
    await bad(
      [{ id: 'c', type: 'cta', heading: 'Hey', label: 'Go', href: '/relative' }],
      'page_invalid_url',
    );
    await bad([{ id: 'i', type: 'image', url: 'ftp://x', alt: '' }], 'page_invalid_image_url');
    // The policy lets the page load images over https only: an http one would save and never show.
    await bad(
      [{ id: 'i', type: 'image', url: 'http://example.com/a.png', alt: '' }],
      'page_invalid_image_url',
    );
    await bad(
      [{ id: 'h', type: 'hero', heading: 'Hey', imageUrl: 'http://example.com/a.png' }],
      'page_invalid_image_url',
    );
    await bad([{ id: 't', type: 'text', html: '  ' }], 'page_text_required');
    await bad(
      [
        { id: 'a', type: 'text', html: '<p>a</p>' },
        { id: 'a', type: 'text', html: '<p>b</p>' },
      ],
      'page_duplicate_section',
    );
    const gone = await createForm(as);
    await as.mutation(api.features.forms.mutations.deleteForm, { formId: gone });
    await bad([{ id: 'f', type: 'form', formId: gone }], 'page_form_unknown');
    await expect(
      as.mutation(api.features.landingPages.mutations.createLandingPage, {
        name: 'x',
        slug: 'x',
        seo: { title: 'x'.repeat(71) },
        sections: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'page_title_too_long' } });

    const empty = await createPage(as, [], 'vide');
    await expect(publish(as, empty)).rejects.toMatchObject({
      data: { code: 'page_sections_required' },
    });
    const dangling = await createPage(
      as,
      [{ id: 'h', type: 'hero', heading: 'Hey', ctaLabel: 'Go', ctaHref: '#form' }],
      'sans-formulaire',
    );
    await expect(publish(as, dangling)).rejects.toMatchObject({
      data: { code: 'page_form_required' },
    });

    const pageId = await createPage(as, demoSections(formId));
    const draft = (await as.query(api.features.landingPages.queries.getLandingPage, { pageId }))
      ?.page;
    expect(draft).toMatchObject({ status: 'draft', formId });
    expect(draft?.publishedAt).toBeUndefined();
    await publish(as, pageId);
    const loaded = await as.query(api.features.landingPages.queries.getLandingPage, { pageId });
    expect(loaded?.page).toMatchObject({ status: 'published', publishedAt: NOW });
    expect(loaded?.url).toBe(`${SITE}/p/demo`);
    // Published, the page cannot be emptied under its visitors.
    await expect(
      as.mutation(api.features.landingPages.mutations.updateLandingPage, {
        pageId,
        name: 'Demande de démo',
        slug: 'demo',
        seo: { title: 'Demande de démo' },
        sections: [],
      }),
    ).rejects.toMatchObject({ data: { code: 'page_sections_required' } });
    await publish(as, pageId, 'draft');
    expect(
      (await as.query(api.features.landingPages.queries.getLandingPage, { pageId }))?.page.status,
    ).toBe('draft');
    expect(await t.run((ctx) => ctx.db.get(pageId))).toMatchObject({ publishedAt: NOW });
  });
});

describe('landing pages: the public page', () => {
  test('only a published page is served, every text escaped, the form embedded with the page’s id, the tracking script when tracking is on', async () => {
    const { t, as } = await setup();
    const formId = await createForm(as);
    const pageId = await createPage(as, demoSections(formId));

    expect((await open(t, 'demo')).status).toBe(404);
    expect((await open(t, 'nope')).status).toBe(404);
    expect((await open(t, 'Demo')).status).toBe(404);
    expect((await open(t, 'demo/extra')).status).toBe(404);

    await publish(as, pageId);
    const res = await open(t, 'demo');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    // The policy names the deployment's origin, in the header and in the document, so the editor's preview frame gets it too.
    const policy = `default-src 'none'; script-src ${SITE}; connect-src ${SITE}; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
    expect(res.headers.get('content-security-policy')).toBe(`${policy}; frame-ancestors 'none'`);
    const html = await res.text();
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll("'", '&#39;')}">`,
    );
    expect(html).toContain('<title>Demande de démo</title>');
    expect(html).toContain('<meta name="description" content="Une démo de trente minutes.">');
    expect(html).toContain(`<link rel="canonical" href="${SITE}/p/demo">`);
    expect(html).toContain('<h1>Demandez une &lt;démo&gt;</h1>');
    expect(html).toContain('Trente minutes &amp; un café.');
    expect(html).toContain('<a class="button" href="#form">Je demande</a>');
    // The editor's HTML, as written.
    expect(html).toContain('<p>Trois raisons <strong>fortes</strong>.</p>');
    expect(html).toContain(
      `<script src="${SITE}/forms/${formId}/embed.js" data-page="${pageId}"></script>`,
    );
    expect(html).not.toContain('track.js');
    expect(html).not.toContain('<script>');

    // The same for the editor's preview, but the form is drawn, not run: nothing is submitted from there.
    const preview = await as.query(api.features.landingPages.queries.previewLandingPage, {
      pageId,
    });
    expect(preview).toContain('Le formulaire s’affiche ici sur la page publiée.');
    expect(preview).not.toContain('embed.js');
    const withoutForm = (page: string) => page.replace(/<section class="form".*?<\/section>/, '');
    expect(withoutForm(preview ?? '')).toBe(withoutForm(html));

    await publish(as, pageId, 'draft');
    expect((await open(t, 'demo')).status).toBe(404);
  });

  test('a form that is no longer active leaves its block out; a tracked deployment adds its script', async () => {
    const { t, as } = await setup(true);
    const formId = await createForm(as);
    const pageId = await createPage(as, demoSections(formId));
    await publish(as, pageId);
    await as.mutation(api.features.forms.mutations.updateForm, { formId, active: false });
    const html = await (await open(t, 'demo')).text();
    expect(html).not.toContain('embed.js');
    expect(html).not.toContain('Vos coordonnées');
    expect(html).toContain(`<script src="${SITE}/track.js" defer></script>`);
  });

  test('past the deployment’s ceiling the page is served and the view is not counted', async () => {
    const { t, as } = await setup();
    const pageId = await createPage(as, [{ id: 't', type: 'text', html: '<p>x</p>' }]);
    await publish(as, pageId);
    // Six hundred and one addresses, one view each: the last is served, not counted.
    for (let i = 0; i <= 600; i++) {
      const res = await t.fetch('/p/demo', {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (test)',
          'x-forwarded-for': `10.0.${i >> 8}.${i & 255}`,
        },
      });
      expect(res.status).toBe(200);
    }
    expect(await stats(as, pageId)).toMatchObject({ views: 600 });
  }, 60_000);

  test('a page under a slug is rate-limited per address', async () => {
    const { t, as } = await setup();
    const pageId = await createPage(as, [{ id: 't', type: 'text', html: '<p>x</p>' }]);
    await publish(as, pageId);
    let last = 200;
    for (let i = 0; i < 125 && last === 200; i++) last = (await open(t, 'demo')).status;
    expect(last).toBe(429);
  });
});

describe('landing pages: views and conversions', () => {
  test('a view is counted when the page is served to a person, not to a crawler, not at a 404; a submission from the page is counted once and attributed to it', async () => {
    const { t, as } = await setup();
    const formId = await createForm(as);
    const pageId = await createPage(as, demoSections(formId));
    const draft = await createPage(as, demoSections(formId), 'brouillon');
    await publish(as, pageId);

    await open(t, 'demo');
    await open(t, 'demo');
    await open(t, 'demo', 'Mozilla/5.0 (compatible; Googlebot/2.1)');
    await open(t, 'nope');
    expect(await stats(as, pageId)).toEqual({
      days: [{ day: '2026-10-09', views: 2, submissions: 0 }],
      views: 2,
      submissions: 0,
      test: null,
    });

    expect((await submitFrom(t, formId, pageId, 'ada@example.com')).status).toBe(200);
    // Not from the page: no page, a draft, a page without this form.
    expect((await submitFrom(t, formId, undefined, 'bob@example.com')).status).toBe(200);
    expect((await submitFrom(t, formId, draft, 'cid@example.com')).status).toBe(200);
    const other = await createPage(as, [{ id: 't', type: 'text', html: '<p>x</p>' }], 'autre');
    await publish(as, other);
    expect((await submitFrom(t, formId, other, 'dan@example.com')).status).toBe(200);
    expect((await submitFrom(t, formId, 'not-an-id', 'eve@example.com')).status).toBe(200);

    const submissions = await t.run((ctx) => ctx.db.query('formSubmissions').collect());
    expect(submissions.map((s) => s.landingPageId)).toEqual([
      pageId,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(await stats(as, pageId)).toMatchObject({ views: 2, submissions: 1 });
    expect(await stats(as, other)).toMatchObject({ views: 0, submissions: 0 });

    // The next day has its own entry; the list carries the totals.
    advance(24 * 3_600_000);
    await open(t, 'demo');
    expect((await stats(as, pageId))?.days).toEqual([
      { day: '2026-10-09', views: 2, submissions: 1 },
      { day: '2026-10-10', views: 1, submissions: 0 },
    ]);
    const listed = await as.query(api.features.landingPages.queries.listLandingPages, {});
    expect(listed.find((p) => p._id === pageId)).toMatchObject({
      slug: 'demo',
      status: 'published',
      views: 3,
      submissions: 1,
    });
  });
});
