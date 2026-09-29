import { LINK_GRANT_PARAM, type TrackingConfig } from '../../_lib/validators/tracking';

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
  function closeBanner() {
    var b = document.getElementById('wap-consent');
    if (b) b.parentNode.removeChild(b);
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
    // A labelled region, not a dialog: it takes no focus from the page.
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Consentement au suivi');
    box.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:560px;margin:0 auto;padding:14px 16px;background:#0f172a;color:#fff;font:14px/1.45 system-ui,sans-serif;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center;flex-wrap:wrap;';
    var text = document.createElement('span');
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
    // First in the page, so first in the reading and tab order.
    var root = document.body || document.documentElement;
    root.insertBefore(box, root.firstChild);
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
