import { beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { DAY_MS } from '../../convex/_lib/time';
import type { LandingSection } from '../../convex/_lib/validators/landingPages';
import { variantFor } from '../../convex/_lib/validators/landingPages';
import { visitorBucket } from '../../convex/lib/landingPages/pages';
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

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, {
    email: 'agent@example.com',
    role: 'admin',
    sessionTtlMs: 3 * DAY_MS,
  });
  await seedConfig(t);
  return { t, as: asIdentity(t, emp.identity) };
}

const createForm = (as: As) =>
  as.mutation(api.features.forms.mutations.createForm, {
    name: 'Démo',
    fields: [{ target: { kind: 'standard', field: 'email' }, label: 'E-mail', required: true }],
    buttonText: 'Envoyer',
    afterSubmit: { kind: 'message', message: 'Merci !' },
    consentText: 'J’accepte.',
    active: true,
  });

const sectionsWith = (heading: string, formId: Id<'forms'>): LandingSection[] => [
  { id: 'hero', type: 'hero', heading, ctaLabel: 'Go', ctaHref: '#form' },
  { id: 'form', type: 'form', formId },
];

/** A published page whose A says « Version A », with a test whose B says « Version B » to `share` percent of visitors. */
async function pageUnderTest(as: As, share = 50) {
  const formId = await createForm(as);
  const pageId = await as.mutation(api.features.landingPages.mutations.createLandingPage, {
    name: 'Démo',
    slug: 'demo',
    seo: { title: 'Démo' },
    sections: sectionsWith('Version A', formId),
  });
  await as.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
    pageId,
    status: 'published',
  });
  await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
    pageId,
    test: { sections: sectionsWith('Version B', formId), share },
  });
  return { pageId, formId };
}

const visit = (t: T, ip: string, userAgent = 'Mozilla/5.0 (test)') =>
  t.fetch('/p/demo', {
    method: 'GET',
    headers: { 'user-agent': userAgent, 'x-forwarded-for': ip },
  });

const stats = (as: As, pageId: Id<'landingPages'>) =>
  as.query(api.features.landingPages.queries.getLandingPageStats, { pageId });

/** A submission as the embed sends it, from a visitor known by their address; `body` adds what a tampered client might. */
async function submitFrom(
  t: T,
  formId: Id<'forms'>,
  page: Id<'landingPages'>,
  ip: string,
  email: string,
  body: Record<string, unknown> = {},
) {
  const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
  const { ts, sig } = (await def.json()) as { ts: number; sig: string };
  advance(5_000);
  return t.fetch(`/forms/${formId}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'user-agent': 'Mozilla/5.0 (test)',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify({
      consent: true,
      renderedAt: ts,
      renderSig: sig,
      values: { 'e-mail': email },
      page,
      ...body,
    }),
  });
}

describe('landing pages: A/B test', () => {
  test('a test needs a share between 1 and 99 and a B that follows the page’s rules, publishable while the page is published', async () => {
    const { as } = await setup();
    const formId = await createForm(as);
    const pageId = await as.mutation(api.features.landingPages.mutations.createLandingPage, {
      name: 'Démo',
      slug: 'demo',
      seo: { title: 'Démo' },
      sections: sectionsWith('A', formId),
    });
    const set = (test: { sections: LandingSection[]; share: number }) =>
      as.mutation(api.features.landingPages.mutations.setLandingPageTest, { pageId, test });
    await expect(set({ sections: sectionsWith('B', formId), share: 0 })).rejects.toMatchObject({
      data: { code: 'page_invalid_share' },
    });
    await expect(set({ sections: sectionsWith('B', formId), share: 100 })).rejects.toMatchObject({
      data: { code: 'page_invalid_share' },
    });
    await expect(set({ sections: sectionsWith('B', formId), share: 50.5 })).rejects.toMatchObject({
      data: { code: 'page_invalid_share' },
    });
    await expect(
      set({ sections: [{ id: 'h', type: 'hero', heading: ' ' }], share: 50 }),
    ).rejects.toMatchObject({ data: { code: 'page_heading_required' } });
    // A draft may carry an empty B; a published page may not, so publishing checks B too.
    await set({ sections: [], share: 50 });
    await expect(
      as.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
        pageId,
        status: 'published',
      }),
    ).rejects.toMatchObject({ data: { code: 'page_sections_required' } });
    await set({ sections: sectionsWith('B', formId), share: 50 });
    await as.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
      pageId,
      status: 'published',
    });
    await expect(set({ sections: [], share: 50 })).rejects.toMatchObject({
      data: { code: 'page_sections_required' },
    });
    await expect(
      set({
        sections: [{ id: 'h', type: 'hero', heading: 'B', ctaLabel: 'Go', ctaHref: '#form' }],
        share: 50,
      }),
    ).rejects.toMatchObject({ data: { code: 'page_form_required' } });
    // Without a test there is no winner to choose.
    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: null,
    });
    await expect(
      as.mutation(api.features.landingPages.mutations.chooseLandingPageWinner, {
        pageId,
        winner: 'a',
      }),
    ).rejects.toMatchObject({ data: { code: 'page_no_test' } });
  });

  test('a visitor always sees the same variant, B for the share of them its bucket falls in, and each variant counts its views', async () => {
    const { t, as } = await setup();
    const { pageId } = await pageUnderTest(as, 50);
    const seen = new Map<string, 'a' | 'b'>();
    for (let i = 0; i < 40; i++) {
      const ip = `10.1.0.${i}`;
      const html = await (await visit(t, ip)).text();
      const variant = html.includes('Version B') ? 'b' : 'a';
      // What the visitor sees is what their bucket says.
      expect(variant).toBe(
        variantFor(
          { id: 'x', startedAt: 0, sections: [], share: 50 },
          await visitorBucket('demo', ip, 'Mozilla/5.0 (test)'),
        ),
      );
      seen.set(ip, variant);
    }
    expect(new Set(seen.values()).size).toBe(2);
    // The same address and browser, again and again: the same variant.
    for (const [ip, variant] of [...seen.entries()].slice(0, 5)) {
      for (let n = 0; n < 3; n++) {
        expect((await (await visit(t, ip)).text()).includes('Version B')).toBe(variant === 'b');
      }
    }
    const counted = await stats(as, pageId);
    const bs = [...seen.values()].filter((v) => v === 'b').length;
    expect(counted?.test?.variants).toEqual({
      a: { views: 40 - bs + extraViews(seen, 'a'), submissions: 0 },
      b: { views: bs + extraViews(seen, 'b'), submissions: 0 },
    });
    expect(counted?.views).toBe(40 + 15);
  });

  test('a conversion is counted on the variant its visitor was shown, drawn again from the address and the browser, whatever the body says; under the test running, none once it stopped', async () => {
    const { t, as } = await setup();
    const { pageId, formId } = await pageUnderTest(as, 50);
    const onB = async (ip: string) =>
      variantFor(
        { id: 'x', startedAt: 0, sections: [], share: 50 },
        await visitorBucket('demo', ip, 'Mozilla/5.0 (test)'),
      ) === 'b';
    const ips = Array.from({ length: 40 }, (_, i) => `10.3.0.${i}`);
    const visitorB = (await Promise.all(ips.map(async (ip) => ((await onB(ip)) ? ip : null)))).find(
      Boolean,
    ) as string;
    const visitorA = (await Promise.all(ips.map(async (ip) => ((await onB(ip)) ? null : ip)))).find(
      Boolean,
    ) as string;

    expect((await submitFrom(t, formId, pageId, visitorB, 'bea@example.com')).status).toBe(200);
    // A client claiming B counts where its address and browser put it.
    expect(
      (await submitFrom(t, formId, pageId, visitorA, 'ada@example.com', { variant: 'b' })).status,
    ).toBe(200);
    expect((await stats(as, pageId))?.test?.variants).toEqual({
      a: { views: 0, submissions: 1 },
      b: { views: 0, submissions: 1 },
    });

    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: null,
    });
    expect((await submitFrom(t, formId, pageId, visitorB, 'eve@example.com')).status).toBe(200);
    const after = await stats(as, pageId);
    expect(after?.test).toBeNull();
    expect(after?.submissions).toBe(3);
  });

  test('a test compares its own figures: not the page’s past, not a test before, and a changed B or share is a new test', async () => {
    const { t, as } = await setup();
    const { pageId, formId } = await pageUnderTest(as, 50);
    // What came before the test is the page's, not the test's.
    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: null,
    });
    for (let i = 0; i < 6; i++) await visit(t, `10.4.0.${i}`);
    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: { sections: sectionsWith('Version B', formId), share: 50 },
    });
    expect((await stats(as, pageId))?.test).toMatchObject({
      startedAt: NOW,
      variants: { a: { views: 0, submissions: 0 }, b: { views: 0, submissions: 0 } },
    });
    for (let i = 0; i < 20; i++) await visit(t, `10.4.1.${i}`);
    const first = (await stats(as, pageId))?.test?.variants;
    expect((first?.a.views ?? 0) + (first?.b.views ?? 0)).toBe(20);
    expect((await stats(as, pageId))?.views).toBe(26);

    // The share changed: a new test, from zero, while the page keeps everything.
    advance(DAY_MS);
    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: { sections: sectionsWith('Version B', formId), share: 30 },
    });
    expect((await stats(as, pageId))?.test).toEqual({
      startedAt: NOW + DAY_MS,
      variants: { a: { views: 0, submissions: 0 }, b: { views: 0, submissions: 0 } },
    });
    await visit(t, '10.4.2.1');
    const second = (await stats(as, pageId))?.test?.variants;
    expect((second?.a.views ?? 0) + (second?.b.views ?? 0)).toBe(1);
    expect((await stats(as, pageId))?.views).toBe(27);
  });

  test('publishing checks B as it checks A', async () => {
    const { as } = await setup();
    const formId = await createForm(as);
    const pageId = await as.mutation(api.features.landingPages.mutations.createLandingPage, {
      name: 'Démo',
      slug: 'demo',
      seo: { title: 'Démo' },
      sections: sectionsWith('A', formId),
    });
    // A draft may hold a B whose button leads nowhere; it cannot go live like that.
    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: {
        sections: [{ id: 'h', type: 'hero', heading: 'B', ctaLabel: 'Go', ctaHref: '#form' }],
        share: 50,
      },
    });
    await expect(
      as.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
        pageId,
        status: 'published',
      }),
    ).rejects.toMatchObject({ data: { code: 'page_form_required' } });
    const gone = await createForm(as);
    await as.mutation(api.features.landingPages.mutations.setLandingPageTest, {
      pageId,
      test: { sections: sectionsWith('B', gone), share: 50 },
    });
    await as.mutation(api.features.forms.mutations.deleteForm, { formId: gone });
    await expect(
      as.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
        pageId,
        status: 'published',
      }),
    ).rejects.toMatchObject({ data: { code: 'page_form_unknown' } });
  });

  test('the winner becomes the page: B’s blocks take A’s place when B wins, the test ends, the counters keep what each got', async () => {
    const { t, as } = await setup();
    const { pageId, formId } = await pageUnderTest(as, 50);
    await submitFrom(t, formId, pageId, '10.5.0.1', 'bea@example.com');
    const previewB = await as.query(api.features.landingPages.queries.previewLandingPage, {
      pageId,
      variant: 'b',
    });
    expect(previewB).toContain('Version B');
    expect(
      await as.query(api.features.landingPages.queries.previewLandingPage, { pageId }),
    ).toContain('Version A');

    await as.mutation(api.features.landingPages.mutations.chooseLandingPageWinner, {
      pageId,
      winner: 'b',
    });
    const page = (await as.query(api.features.landingPages.queries.getLandingPage, { pageId }))
      ?.page;
    expect(page?.abTest).toBeUndefined();
    expect(page?.sections.map((s) => (s.type === 'hero' ? s.heading : s.type))).toEqual([
      'Version B',
      'form',
    ]);
    expect(page?.formId).toBe(formId);
    for (let i = 0; i < 10; i++) {
      const html = await (await visit(t, `10.2.0.${i}`)).text();
      expect(html).toContain('Version B');
    }
    const after = await stats(as, pageId);
    expect(after?.test).toBeNull();
    expect(after).toMatchObject({ views: 10, submissions: 1 });
    const audits = await t.run((ctx) => ctx.db.query('auditLogs').collect());
    expect(audits.at(-1)?.metadata).toMatchObject({ test: 'won', winner: 'b' });
  });
});

/** The three repeat visits of each of the first five visitors, by variant. */
function extraViews(seen: Map<string, 'a' | 'b'>, variant: 'a' | 'b'): number {
  return [...seen.values()].slice(0, 5).filter((v) => v === variant).length * 3;
}
