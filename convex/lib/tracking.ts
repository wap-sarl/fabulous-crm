import { z } from 'zod';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { AppConfig } from '../_lib/validators/appConfig';
import {
  ATTACH_BATCH,
  type BeaconView,
  DEFAULT_TRACKING,
  LINK_GRANT_PARAM,
  LINK_GRANT_RE,
  MAX_BEACON_EVENTS,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  REFRESH_LEADS,
  REFRESH_SCAN,
  type TrackingConfig,
  type ViewMarks,
  VISITED_PAGES_MAX,
  VISITED_PATH_MAX,
  VISITOR_ID_RE,
} from '../_lib/validators/tracking';
import { isNotDeleted } from './dbHelpers';
import { profilingExcluded } from './leadSignals';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The tracking settings in force: the stored ones, the defaults for the rest. */
export function trackingConfigOf(config: Pick<AppConfig, 'tracking'> | null): TrackingConfig {
  return { ...DEFAULT_TRACKING, ...(config?.tracking ?? {}) };
}

export async function loadTrackingConfig(ctx: QueryCtx | MutationCtx): Promise<TrackingConfig> {
  return trackingConfigOf(await ctx.db.query('appConfig').first());
}

/** Named tracking at work: the switch on, the mode named. */
export const namedTracking = (config: TrackingConfig): boolean =>
  config.enabled && config.mode === 'named';

/** Whether a URL lands on one of the sites the script runs on. */
export function onAllowedSite(config: TrackingConfig, url: string | undefined): boolean {
  if (!url) return false;
  try {
    return config.allowedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

const beaconSchema = z.object({
  v: z.string().regex(VISITOR_ID_RE),
  // A value of the wrong shape is no grant, not a bad beacon.
  l: z.string().regex(LINK_GRANT_RE).optional().catch(undefined),
  e: z.array(z.unknown()),
});
const viewSchema = z.object({
  u: z.string().trim().max(MAX_URL_LENGTH),
  t: z.string().optional().catch(undefined),
  r: z.string().optional().catch(undefined),
  at: z.number().optional().catch(undefined),
});

export interface Beacon {
  visitorId: string;
  grant?: string;
  views: BeaconView[];
}

/** A view worth storing: on the site that sent it, within bounds, the time clamped to the last day. */
function cleanView(raw: unknown, origin: string, now: number): BeaconView | null {
  const parsed = viewSchema.safeParse(raw);
  if (!parsed.success) return null;
  let url: URL;
  try {
    url = new URL(parsed.data.u);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  // The script strips it from the address bar; a page that kept it does not get it stored.
  url.searchParams.delete(LINK_GRANT_PARAM);
  const referrer = parsed.data.r;
  return {
    url: url.toString(),
    path: url.pathname || '/',
    title: parsed.data.t?.trim().slice(0, MAX_TITLE_LENGTH) || undefined,
    referrer:
      referrer && /^https?:\/\//i.test(referrer) ? referrer.slice(0, MAX_URL_LENGTH) : undefined,
    // A clock a day off is the browser's business; further than that it is noise.
    at: Math.min(now, Math.max(now - DAY_MS, parsed.data.at ?? now)),
  };
}

/** The one boundary of a beacon: its body parsed, its views cleaned; null when it is not a beacon. */
export function parseBeacon(text: string, origin: string, now: number): Beacon | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = beaconSchema.safeParse(raw);
  if (!parsed.success) return null;
  const views = parsed.data.e
    .slice(0, MAX_BEACON_EVENTS)
    .map((item) => cleanView(item, origin, now))
    .filter((view): view is BeaconView => view !== null);
  return { visitorId: parsed.data.v, grant: parsed.data.l, views };
}

/** A request body as text, read no further than `max` bytes; null past it. */
export async function readCapped(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > max) return null;
  const reader = request.body?.getReader();
  if (!reader) {
    // No stream to read from: the declared length was the only guard, the platform's own cap the other.
    const text = await request.text();
    return text.length > max ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** The contact's visited paths with these added: distinct, in the order of the last visits, bounded. */
export function mergeVisitedPages(
  current: string[] | undefined,
  paths: string[],
  earlier = false,
): string[] {
  const cut = paths.map((p) => p.slice(0, VISITED_PATH_MAX));
  // Views from before the ones already there (the attach job's) go in front.
  const ordered = earlier ? [...cut, ...(current ?? [])] : [...(current ?? []), ...cut];
  return ordered.filter((p, i) => ordered.lastIndexOf(p) === i).slice(-VISITED_PAGES_MAX);
}

/** What a set of views leaves on a contact: how many, the last date, the paths in browsing order. */
export function marksOf(views: { path: string; at: number }[]): ViewMarks {
  const ordered = [...views].sort((a, b) => a.at - b.at);
  return {
    count: views.length,
    latest: ordered.length ? ordered[ordered.length - 1].at : 0,
    paths: mergeVisitedPages(
      [],
      ordered.map((v) => v.path),
    ),
  };
}

export function addMarks(a: ViewMarks | undefined, b: ViewMarks): ViewMarks {
  if (!a) return b;
  return {
    count: a.count + b.count,
    latest: Math.max(a.latest, b.latest),
    paths: mergeVisitedPages(a.paths, b.paths),
  };
}

/** The behavioural marks of a contact without tracking: none. */
export const NO_VIEW_MARKS = {
  pageViewCount: undefined,
  lastPageViewAt: undefined,
  visitedPages: undefined,
} as const;

export const hasViewMarks = (lead: Doc<'leads'>): boolean =>
  lead.pageViewCount !== undefined ||
  lead.lastPageViewAt !== undefined ||
  lead.visitedPages !== undefined;

/** Writes views' marks on a contact; one who objected to profiling only has the activity date moved. */
export async function applyViewsToLead(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  marks: ViewMarks,
  earlier = false,
): Promise<void> {
  if (marks.count === 0) return;
  const lead = await ctx.db.get(leadId);
  if (!lead || !isNotDeleted(lead)) return;
  const patch: Partial<Doc<'leads'>> = {};
  if ((lead.lastActivityAt ?? 0) < marks.latest) patch.lastActivityAt = marks.latest;
  if (!profilingExcluded(lead)) {
    patch.pageViewCount = (lead.pageViewCount ?? 0) + marks.count;
    if ((lead.lastPageViewAt ?? 0) < marks.latest) patch.lastPageViewAt = marks.latest;
    patch.visitedPages = mergeVisitedPages(lead.visitedPages, marks.paths, earlier);
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
}

/** Two contacts' marks as one, for a merge: the counts added, the paths of the last visitor last. */
export function mergedViewMarks(
  survivor: Doc<'leads'>,
  absorbed: Doc<'leads'>,
): Partial<Pick<Doc<'leads'>, 'pageViewCount' | 'lastPageViewAt' | 'visitedPages'>> {
  if (!hasViewMarks(absorbed)) return {};
  const absorbedLast = (absorbed.lastPageViewAt ?? 0) > (survivor.lastPageViewAt ?? 0);
  return {
    pageViewCount: (survivor.pageViewCount ?? 0) + (absorbed.pageViewCount ?? 0),
    lastPageViewAt: Math.max(survivor.lastPageViewAt ?? 0, absorbed.lastPageViewAt ?? 0),
    visitedPages: mergeVisitedPages(
      survivor.visitedPages,
      absorbed.visitedPages ?? [],
      !absorbedLast,
    ),
  };
}

/** One batch of a contact's browsers and views made anonymous again; true while some are left. */
export async function detachLeadTracking(ctx: MutationCtx, leadId: Id<'leads'>): Promise<boolean> {
  const visitors = await ctx.db
    .query('webVisitors')
    .withIndex('by_lead', (q) => q.eq('leadId', leadId))
    .take(ATTACH_BATCH);
  for (const row of visitors)
    await ctx.db.patch(row._id, { leadId: undefined, pending: undefined });
  const views = await ctx.db
    .query('pageViews')
    .withIndex('by_lead_at', (q) => q.eq('leadId', leadId))
    .take(ATTACH_BATCH);
  for (const row of views) await ctx.db.patch(row._id, { leadId: undefined });
  return visitors.length === ATTACH_BATCH || views.length === ATTACH_BATCH;
}

/** A contact stops being tracked (an objection): the marks go now, the browsers and views in batches. */
export async function stopLeadTracking(ctx: MutationCtx, leadId: Id<'leads'>): Promise<void> {
  if (await detachLeadTracking(ctx, leadId)) {
    await ctx.scheduler.runAfter(0, internal.features.tracking.internal.detachLead, { leadId });
  }
}

/** The purge removed these views: their contacts' marks are rebuilt from what is left, a few contacts per step. */
export async function scheduleViewRefresh(
  ctx: MutationCtx,
  rows: { leadId?: Id<'leads'> }[],
): Promise<void> {
  const removed = new Map<Id<'leads'>, number>();
  for (const row of rows) {
    if (row.leadId) removed.set(row.leadId, (removed.get(row.leadId) ?? 0) + 1);
  }
  const leads = [...removed].map(([leadId, count]) => ({ leadId, removed: count }));
  for (let i = 0; i < leads.length; i += REFRESH_LEADS) {
    await ctx.scheduler.runAfter(0, internal.features.tracking.internal.refreshLeadViews, {
      leads: leads.slice(i, i + REFRESH_LEADS),
    });
  }
}

/** A contact's marks after a purge: the paths of the views that survive, the count less what went. */
export async function refreshViewMarks(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  removed: number,
): Promise<void> {
  const lead = await ctx.db.get(leadId);
  if (!lead || !isNotDeleted(lead) || !hasViewMarks(lead)) return;
  const rows = await ctx.db
    .query('pageViews')
    .withIndex('by_lead_at', (q) => q.eq('leadId', leadId))
    .order('desc')
    .take(REFRESH_SCAN);
  if (rows.length === 0) {
    await ctx.db.patch(leadId, NO_VIEW_MARKS);
    return;
  }
  await ctx.db.patch(leadId, {
    pageViewCount: Math.max(0, (lead.pageViewCount ?? 0) - removed),
    lastPageViewAt: rows[0].at,
    visitedPages: mergeVisitedPages(
      [],
      rows.reverse().map((r) => r.path),
    ),
  });
}

const BANNER_TEXT = {
  anonymous: 'Ce site mesure sa fréquentation avec un cookie de suivi. Acceptez-vous ce suivi ?',
  named:
    'Ce site utilise un cookie pour suivre les pages que vous consultez et, si vous vous identifiez (formulaire envoyé, lien reçu par e-mail), les rattacher à votre fiche de contact afin de personnaliser nos échanges. Acceptez-vous ce suivi ?',
} as const;

/** The script the deployment serves, its settings baked in; `base` is the deployment's origin. Nothing runs before consent. */
export function trackingScript(
  base: string,
  config: Pick<TrackingConfig, 'enabled' | 'mode' | 'privacyUrl'>,
): string {
  const cfg = {
    base,
    enabled: config.enabled,
    mode: config.mode,
    privacyUrl: config.privacyUrl ?? null,
    text: BANNER_TEXT[config.mode],
  };
  return `(function () {
  var CFG = ${JSON.stringify(cfg)};
  var noop = function () {};
  // Global Privacy Control is the signal browsers send today; Do Not Track for those that still do.
  var optedOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  if (!CFG.enabled || optedOut) {
    // A consent manager may call these whatever the state.
    window.wapTrack = { consent: noop, pageview: noop };
    return;
  }
  var COOKIE = '_wapv', CONSENT = '_wapc';
  var COOKIE_AGE = 13 * 30 * 86400, CONSENT_MS = 6 * 30 * 86400000;
  var SECURE = location.protocol === 'https:' ? '; Secure' : '';
  var replaceState = history.replaceState;
  function readCookie() {
    var m = document.cookie.match(/(?:^|; )_wapv=([0-9a-f]{32})(?:;|$)/);
    return m ? m[1] : null;
  }
  function visitorId() {
    var id = readCookie();
    if (id) return id;
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    id = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    // First-party, thirteen months from the first visit and no longer, never sent cross-site.
    document.cookie = COOKIE + '=' + id + '; Max-Age=' + COOKIE_AGE + '; Path=/; SameSite=Lax' + SECURE;
    // Cookies blocked: no id would hold from one page to the next, so nothing is sent.
    return readCookie() === id ? id : null;
  }
  function remembered() {
    try {
      var p = (localStorage.getItem(CONSENT) || '').split(':');
      // A choice is asked again after six months.
      if (p.length !== 3 || !(Date.now() - Number(p[2]) < CONSENT_MS)) return null;
      if (p[0] === '0') return false;
      // An accord given to audience measurement does not cover named tracking.
      if (p[0] === '1' && p[1] === CFG.mode) return true;
    } catch (e) {}
    return null;
  }
  function consentState() {
    if (window.wapTracking && typeof window.wapTracking.consent === 'boolean') return window.wapTracking.consent;
    return remembered();
  }
  // A tracked link's one-time value leaves the address bar at once; it is sent only after consent.
  var grant = null;
  try {
    var here = new URL(location.href);
    grant = here.searchParams.get('${LINK_GRANT_PARAM}');
    if (grant) {
      here.searchParams.delete('${LINK_GRANT_PARAM}');
      replaceState.call(history, history.state, '', here.pathname + here.search + here.hash);
    }
  } catch (e) {}
  var started = false, lastUrl = null, unhook = [];
  function send() {
    if (!started || location.href === lastUrl) return;
    var id = visitorId();
    if (!id) return;
    var body = JSON.stringify({
      v: id,
      l: grant || undefined,
      e: [{ u: location.href, t: document.title, r: lastUrl || document.referrer, at: Date.now() }]
    });
    lastUrl = location.href;
    grant = null;
    if (navigator.sendBeacon) navigator.sendBeacon(CFG.base + '/track', body);
    else fetch(CFG.base + '/track', { method: 'POST', body: body, keepalive: true }).catch(function () {});
  }
  function later() { setTimeout(send, 0); }
  function hook(name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    var wrapped = function () { var out = original.apply(this, arguments); later(); return out; };
    history[name] = wrapped;
    unhook.push(function () { if (history[name] === wrapped) history[name] = original; });
  }
  function listen(name) {
    window.addEventListener(name, later);
    unhook.push(function () { window.removeEventListener(name, later); });
  }
  // The deployment's forms in an iframe cannot read this site's cookie: they are told the id.
  function tellForms(id) {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      var frame = frames[i];
      if (String(frame.src).indexOf(CFG.base + '/forms/') !== 0 || !frame.contentWindow) continue;
      frame.contentWindow.postMessage({ wap: 'visitor', id: id }, CFG.base);
    }
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== CFG.base || !ev.data || ev.data.wap !== 'visitor?' || !ev.source) return;
    ev.source.postMessage({ wap: 'visitor', id: started ? readCookie() : null }, CFG.base);
  });
  function start() {
    if (started) return;
    started = true;
    hook('pushState');
    hook('replaceState');
    listen('popstate');
    listen('hashchange');
    send();
    tellForms(readCookie());
  }
  function stop() {
    started = false;
    lastUrl = null;
    grant = null;
    while (unhook.length) unhook.pop()();
    document.cookie = COOKIE + '=; Max-Age=0; Path=/; SameSite=Lax' + SECURE;
    tellForms(null);
  }
  var focusBack = null;
  function closeBanner() {
    var b = document.getElementById('wap-consent');
    if (!b) return;
    b.parentNode.removeChild(b);
    if (focusBack && typeof focusBack.focus === 'function') focusBack.focus();
    focusBack = null;
  }
  function decide(ok) {
    try { localStorage.setItem(CONSENT, (ok ? '1' : '0') + ':' + CFG.mode + ':' + Date.now()); } catch (e) {}
    closeBanner();
    if (ok) start(); else stop();
  }
  function banner() {
    if (document.getElementById('wap-consent')) return;
    var box = document.createElement('div');
    box.id = 'wap-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-label', 'Consentement au suivi');
    box.setAttribute('aria-describedby', 'wap-consent-text');
    box.tabIndex = -1;
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;padding:14px 16px;background:#0f172a;color:#fff;font:14px/1.45 system-ui,sans-serif;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;flex-wrap:wrap;';
    var text = document.createElement('span');
    text.id = 'wap-consent-text';
    text.style.cssText = 'flex:1 1 260px;';
    text.textContent = CFG.text;
    if (CFG.privacyUrl) {
      var policy = document.createElement('a');
      policy.href = CFG.privacyUrl;
      policy.target = '_blank';
      policy.rel = 'noopener';
      policy.textContent = 'Politique de confidentialité';
      policy.style.cssText = 'color:inherit;text-decoration:underline;';
      text.appendChild(document.createTextNode(' '));
      text.appendChild(policy);
    }
    var yes = document.createElement('button');
    yes.type = 'button'; yes.textContent = 'Accepter';
    yes.style.cssText = 'padding:8px 14px;border:0;border-radius:8px;background:#fff;color:#0f172a;font:inherit;font-weight:600;cursor:pointer;';
    var no = document.createElement('button');
    no.type = 'button'; no.textContent = 'Refuser';
    no.style.cssText = 'padding:8px 14px;border:1px solid #64748b;border-radius:8px;background:transparent;color:#fff;font:inherit;cursor:pointer;';
    yes.onclick = function () { decide(true); };
    no.onclick = function () { decide(false); };
    box.appendChild(text); box.appendChild(yes); box.appendChild(no);
    // First in the page, so first in the reading and tab order; the focus goes back where it was on a choice.
    var root = document.body || document.documentElement;
    root.insertBefore(box, root.firstChild);
    focusBack = document.activeElement;
    box.focus();
  }
  // The site's own consent manager calls these instead of the banner.
  window.wapTrack = { consent: decide, pageview: send };
  var c = consentState();
  if (c === true) start();
  else if (c === null && !window.wapTracking) {
    if (document.body) banner(); else document.addEventListener('DOMContentLoaded', banner);
  }
})();
`;
}
