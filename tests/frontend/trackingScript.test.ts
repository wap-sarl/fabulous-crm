import { describe, expect, test } from 'bun:test';
import { FORM_EMBED_JS } from '../../convex/lib/forms/embed';
import { trackingScript } from '../../convex/lib/tracking/script';
import { type FakeElement, fakeBrowser } from './fakeBrowser';

const BASE = 'https://crm.convex.site';
const SITE = 'https://www.example.fr';
const MONTH = 30 * 24 * 60 * 60 * 1000;
const POLICY = `${SITE}/confidentialite`;

type Mode = 'anonymous' | 'named';
const script = (mode: Mode = 'anonymous', enabled = true) =>
  trackingScript(BASE, { enabled, mode, privacyUrl: mode === 'named' ? POLICY : undefined });
const accepted = (mode: Mode = 'anonymous', at = Date.now()) => ({ _wapc: `1:${mode}:${at}` });
const press = (banner: FakeElement | null, label: string) => {
  const button = banner?.children.find((el) => el.textContent === label);
  if (!button) throw new Error(`no « ${label} » button`);
  (button.onclick as () => void)();
};

describe('the tracking script', () => {
  test('nothing runs before consent; the banner is a labelled region, first in the page, that takes no focus and says what the mode does', () => {
    const page = fakeBrowser({ url: `${SITE}/` });
    page.run(script());
    expect(page.beacons).toEqual([]);
    expect(page.cookie('_wapv')).toBeUndefined();
    const banner = page.banner();
    expect(banner?.attributes).toEqual({
      role: 'region',
      'aria-label': 'Consentement au suivi',
    });
    expect(page.document.activeElement).toBeNull();
    expect(page.document.body.children[0]).toBe(banner);
    expect(banner?.children[0].textContent).toContain('mesure sa fréquentation');
    expect(banner?.children[0].children).toEqual([]);

    press(banner, 'Accepter');
    expect(page.banner()).toBeNull();
    expect(page.cookie('_wapv')).toMatch(/^[0-9a-f]{32}$/);
    expect(page.storage.get('_wapc')).toMatch(/^1:anonymous:\d+$/);
    expect(page.beacons).toHaveLength(1);
    expect(page.beacons[0]).toMatchObject({
      url: `${BASE}/track`,
      body: { v: page.cookie('_wapv'), e: [{ u: `${SITE}/` }] },
    });

    // Named mode: the purpose is the attachment to the contact, and the policy is one link away.
    const named = fakeBrowser({ url: `${SITE}/` });
    named.run(script('named'));
    const text = named.banner()?.children[0];
    expect(text?.textContent).toContain('rattacher à votre fiche de contact');
    expect(text?.children.find((el) => el.tagName === 'a')).toMatchObject({ href: POLICY });
  });

  test('a single-page site: pushState, replaceState, the back button and a hash change each send a view, the same address none', () => {
    const page = fakeBrowser({ url: `${SITE}/`, storage: accepted() });
    page.run(script());
    expect(page.banner()).toBeNull();
    page.history.pushState(null, '', '/a');
    page.history.replaceState(null, '', '/b');
    page.history.replaceState(null, '', '/b');
    page.moveTo('/b#prix');
    page.dispatch('hashchange');
    page.moveTo('/c');
    page.dispatch('popstate');
    const sent = page.beacons.map((b) => (b.body.e as { u: string; r: string }[])[0]);
    expect(sent.map((e) => e.u)).toEqual(
      ['/', '/a', '/b', '/b#prix', '/c'].map((path) => `${SITE}${path}`),
    );
    // Inside the site, the page before is the referrer.
    expect(sent[1].r).toBe(`${SITE}/`);
    expect(new Set(page.beacons.map((b) => b.body.v)).size).toBe(1);
  });

  test('a consent withdrawn stops the views, takes the hooks off and removes the cookie; given again, it starts again', () => {
    const page = fakeBrowser({ url: `${SITE}/`, storage: accepted() });
    const { pushState, replaceState } = page.history;
    page.run(script());
    expect(page.history.pushState).not.toBe(pushState);
    expect(page.beacons).toHaveLength(1);

    page.window.wapTrack.consent(false);
    expect(page.cookie('_wapv')).toBeUndefined();
    expect(page.storage.get('_wapc')).toMatch(/^0:anonymous:/);
    expect(page.history.pushState).toBe(pushState);
    expect(page.history.replaceState).toBe(replaceState);
    page.history.pushState(null, '', '/a');
    page.moveTo('/b');
    page.dispatch('popstate');
    page.window.wapTrack.pageview();
    expect(page.beacons).toHaveLength(1);

    page.window.wapTrack.consent(true);
    expect(page.beacons).toHaveLength(2);
    expect(page.beacons[1].body.v).not.toBe(page.beacons[0].body.v);
  });

  test('switched off, or under Global Privacy Control: an API that does nothing, and nothing else', () => {
    const off = fakeBrowser({ url: `${SITE}/`, storage: accepted() });
    off.run(script('anonymous', false));
    const gpc = fakeBrowser({ url: `${SITE}/`, storage: accepted(), gpc: true });
    gpc.run(script());
    for (const page of [off, gpc]) {
      expect(() => page.window.wapTrack.consent(true)).not.toThrow();
      expect(() => page.window.wapTrack.pageview()).not.toThrow();
      page.history.pushState(null, '', '/a');
      expect(page.beacons).toEqual([]);
      expect(page.banner()).toBeNull();
      expect(page.cookie('_wapv')).toBeUndefined();
    }
  });

  test('cookies blocked: no id holds, so nothing is sent', () => {
    const page = fakeBrowser({ url: `${SITE}/`, storage: accepted(), cookies: false });
    page.run(script());
    page.history.pushState(null, '', '/a');
    expect(page.beacons).toEqual([]);
  });

  test('a consent lasts six months and covers the mode it was given for; a refusal stands', () => {
    const old = fakeBrowser({
      url: `${SITE}/`,
      storage: accepted('anonymous', Date.now() - 7 * MONTH),
    });
    old.run(script());
    expect(old.beacons).toEqual([]);
    expect(old.banner()).not.toBeNull();

    const other = fakeBrowser({ url: `${SITE}/`, storage: accepted('anonymous') });
    other.run(script('named'));
    expect(other.beacons).toEqual([]);
    expect(other.banner()).not.toBeNull();

    const refused = fakeBrowser({
      url: `${SITE}/`,
      storage: { _wapc: `0:anonymous:${Date.now()}` },
    });
    refused.run(script('named'));
    expect(refused.beacons).toEqual([]);
    expect(refused.banner()).toBeNull();
  });

  test('a tracked link’s value leaves the address bar at once and is sent once, after consent', () => {
    const page = fakeBrowser({ url: `${SITE}/tarifs?utm=x&wapl=one-time-value#top` });
    page.run(script('named'));
    expect(page.location.href).toBe(`${SITE}/tarifs?utm=x#top`);
    expect(page.beacons).toEqual([]);

    press(page.banner(), 'Accepter');
    page.history.pushState(null, '', '/contact');
    expect(page.beacons.map((b) => b.body.l)).toEqual(['one-time-value', undefined]);
    expect((page.beacons[0].body.e as { u: string }[])[0].u).toBe(`${SITE}/tarifs?utm=x#top`);
  });

  test('a form in an iframe is told the visitor id by the page, once the visitor agreed, and only the deployment’s', async () => {
    const page = fakeBrowser({ url: `${SITE}/contact` });
    const told: unknown[] = [];
    const frame = page.element('iframe');
    frame.src = `${BASE}/forms/abc`;
    frame.contentWindow = { postMessage: (data, origin) => told.push({ data, origin }) };
    page.document.body.appendChild(frame);
    const foreign = page.element('iframe');
    foreign.src = 'https://elsewhere.example/forms/abc';
    foreign.contentWindow = { postMessage: () => told.push('foreign') };
    page.document.body.appendChild(foreign);
    page.run(script('named'));

    const replies: unknown[] = [];
    const ask = (origin: string) =>
      page.dispatch('message', {
        origin,
        data: { wap: 'visitor?' },
        source: { postMessage: (data: unknown, to: string) => replies.push({ data, to }) },
      });
    ask(BASE);
    expect(replies).toEqual([{ data: { wap: 'visitor', id: null }, to: BASE }]);

    press(page.banner(), 'Accepter');
    const id = page.cookie('_wapv');
    expect(told).toEqual([{ data: { wap: 'visitor', id }, origin: BASE }]);
    ask(BASE);
    ask('https://elsewhere.example');
    expect(replies).toHaveLength(2);
    expect(replies[1]).toEqual({ data: { wap: 'visitor', id }, to: BASE });
    page.window.wapTrack.consent(false);
    expect(told[1]).toEqual({ data: { wap: 'visitor', id: null }, origin: BASE });

    // The form's side, in the iframe: it asks its parent, and the submission carries what it was told.
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const form = fakeBrowser({
      url: `${BASE}/forms/abc`,
      framed: true,
      fetch: async (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
        const def = {
          fields: [{ key: 'email', label: 'E-mail', required: true, input: 'email' }],
          knownFields: [],
          consentText: 'OK',
          buttonText: 'Envoyer',
          ts: 1,
          sig: 's',
        };
        const done = { ok: true, afterSubmit: { kind: 'message', message: 'Merci' } };
        return { ok: true, status: 200, json: async () => (init ? done : def) };
      },
    });
    const tag = form.element('script');
    tag.src = `${BASE}/forms/abc/embed.js`;
    form.document.body.appendChild(tag);
    form.document.currentScript = tag;
    form.run(FORM_EMBED_JS);
    expect(form.posted).toEqual([{ data: { wap: 'visitor?' }, origin: '*' }]);
    await form.flush();

    const submit = () => {
      const [el] = form.document.querySelectorAll('form');
      el.listeners.submit({ preventDefault: () => {} });
      return calls[calls.length - 1];
    };
    // Nothing told yet, and the deployment's own cookies are not the site's.
    expect(submit().body?.trackingVisitor).toBeUndefined();
    form.dispatch('message', { source: {}, data: { wap: 'visitor', id } });
    expect(submit().body?.trackingVisitor).toBeUndefined();
    form.dispatch('message', { source: form.parent, data: { wap: 'visitor', id } });
    expect(submit()).toMatchObject({
      url: `${BASE}/forms/abc/submit`,
      body: { trackingVisitor: id },
    });
  });
});
