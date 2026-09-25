import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { AppConfig } from '../_lib/validators/appConfig';
import {
  DEFAULT_TRACKING,
  MAX_TITLE_LENGTH,
  MAX_URL_LENGTH,
  type TrackingConfig,
  VISITED_PAGES_MAX,
} from '../_lib/validators/tracking';
import { isNotDeleted } from './dbHelpers';
import { profilingExcluded } from './leadSignals';

/** The tracking settings in force: the stored ones, the defaults for the rest. */
export function trackingConfigOf(config: Pick<AppConfig, 'tracking'> | null): TrackingConfig {
  return { ...DEFAULT_TRACKING, ...(config?.tracking ?? {}) };
}

export async function loadTrackingConfig(ctx: QueryCtx | MutationCtx): Promise<TrackingConfig> {
  return trackingConfigOf(await ctx.db.query('appConfig').first());
}

/** A beacon's view as the script sends it. */
export interface BeaconEvent {
  url: string;
  title?: string;
  referrer?: string;
  at: number;
}

/** A view worth storing: an http(s) URL within bounds, the title and referrer cut, the time clamped to the last day. */
export function cleanBeaconEvent(raw: unknown, now: number): BeaconEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const url = typeof e.u === 'string' ? e.u.trim() : '';
  if (!/^https?:\/\//i.test(url) || url.length > MAX_URL_LENGTH) return null;
  const at = typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : now;
  return {
    url,
    title:
      typeof e.t === 'string' && e.t.trim() ? e.t.trim().slice(0, MAX_TITLE_LENGTH) : undefined,
    referrer:
      typeof e.r === 'string' && /^https?:\/\//i.test(e.r)
        ? e.r.slice(0, MAX_URL_LENGTH)
        : undefined,
    // A clock a day off is the browser's business; further than that it is noise.
    at: Math.min(now, Math.max(now - 24 * 60 * 60 * 1000, at)),
  };
}

/** The path of a URL, query and fragment dropped: what « a visité la page » matches. */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || '/';
  } catch {
    return '/';
  }
}

/**
 * The contact's visited paths with these added: distinct, the most recent last, bounded. Views that happened
 * before the ones already there (the attach job's) go in front, so the order stays the browsing order.
 */
export function mergeVisitedPages(
  current: string[] | undefined,
  paths: string[],
  earlier = false,
): string[] {
  const fresh: string[] = [];
  for (const p of paths) if (!fresh.includes(p)) fresh.push(p);
  const kept = (current ?? []).filter((p) => !fresh.includes(p) || earlier);
  const out = earlier ? [...fresh.filter((p) => !kept.includes(p)), ...kept] : [...kept, ...fresh];
  return out.slice(-VISITED_PAGES_MAX);
}

/**
 * The behavioural marks `n` views leave on a contact: the counter, the last date, the visited paths. Nothing for a
 * contact who objected to profiling; the activity date alone moves, as for every other signal.
 */
export async function applyViewsToLead(
  ctx: MutationCtx,
  leadId: Id<'leads'>,
  views: { path: string; at: number }[],
  earlier = false,
): Promise<void> {
  if (views.length === 0) return;
  const lead = await ctx.db.get(leadId);
  if (!lead || !isNotDeleted(lead)) return;
  const latest = Math.max(...views.map((v) => v.at));
  const patch: Partial<Doc<'leads'>> = {};
  if ((lead.lastActivityAt ?? 0) < latest) patch.lastActivityAt = latest;
  if (!profilingExcluded(lead)) {
    patch.pageViewCount = (lead.pageViewCount ?? 0) + views.length;
    if ((lead.lastPageViewAt ?? 0) < latest) patch.lastPageViewAt = latest;
    patch.visitedPages = mergeVisitedPages(
      lead.visitedPages,
      [...views].sort((a, b) => a.at - b.at).map((v) => v.path),
      earlier,
    );
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(leadId, patch);
}

/** The script the deployment serves; `base` is its own origin, `enabled` the switch. Nothing runs before consent. */
export function trackingScript(base: string, enabled: boolean): string {
  return `(function () {
  var CFG = ${JSON.stringify({ base, enabled })};
  if (!CFG.enabled) return;
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  var COOKIE = '_wapv', CONSENT = '_wapc';
  function readCookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function visitorId() {
    var id = readCookie(COOKIE);
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
      var bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      id = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    // First-party, thirteen months, never sent cross-site.
    document.cookie = COOKIE + '=' + id + '; Max-Age=' + (13 * 30 * 86400) + '; Path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
    return id;
  }
  function consentState() {
    if (window.wapTracking && typeof window.wapTracking.consent === 'boolean') return window.wapTracking.consent;
    try { var c = localStorage.getItem(CONSENT); if (c === '1') return true; if (c === '0') return false; } catch (e) {}
    return null;
  }
  var started = false, lastUrl = null;
  function send() {
    if (!started) return;
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    var link = null;
    try { link = new URLSearchParams(location.search).get('wapl'); } catch (e) {}
    var body = JSON.stringify({
      v: visitorId(),
      l: link || undefined,
      e: [{ u: location.href, t: document.title, r: document.referrer, at: Date.now() }]
    });
    if (navigator.sendBeacon) navigator.sendBeacon(CFG.base + '/track', body);
    else fetch(CFG.base + '/track', { method: 'POST', body: body, keepalive: true }).catch(function () {});
  }
  function start() {
    if (started) return;
    started = true;
    send();
    var push = history.pushState;
    history.pushState = function () { push.apply(this, arguments); setTimeout(send, 0); };
    window.addEventListener('popstate', function () { setTimeout(send, 0); });
  }
  function decide(ok) {
    try { localStorage.setItem(CONSENT, ok ? '1' : '0'); } catch (e) {}
    var b = document.getElementById('wap-consent');
    if (b) b.parentNode.removeChild(b);
    if (ok) start();
  }
  function banner() {
    if (document.getElementById('wap-consent')) return;
    var box = document.createElement('div');
    box.id = 'wap-consent';
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;padding:14px 16px;background:#0f172a;color:#fff;font:14px/1.45 system-ui,sans-serif;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;flex-wrap:wrap;';
    var text = document.createElement('span');
    text.style.cssText = 'flex:1 1 260px;';
    text.textContent = 'Ce site mesure sa fréquentation avec un cookie de suivi. Acceptez-vous ce suivi ?';
    var yes = document.createElement('button');
    yes.type = 'button'; yes.textContent = 'Accepter';
    yes.style.cssText = 'padding:8px 14px;border:0;border-radius:8px;background:#fff;color:#0f172a;font:inherit;font-weight:600;cursor:pointer;';
    var no = document.createElement('button');
    no.type = 'button'; no.textContent = 'Refuser';
    no.style.cssText = 'padding:8px 14px;border:1px solid #64748b;border-radius:8px;background:transparent;color:#fff;font:inherit;cursor:pointer;';
    yes.onclick = function () { decide(true); };
    no.onclick = function () { decide(false); };
    box.appendChild(text); box.appendChild(yes); box.appendChild(no);
    (document.body || document.documentElement).appendChild(box);
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
