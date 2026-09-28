import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { extensions } from './extensions';
import { registerApiRoutes } from './features/api/routes';
import { appOrigin, resolveBrevo, timingSafeEqual } from './lib';
import {
  providerErrorDescription,
  randomToken,
  sha256Base64Url,
  verifyState,
} from './lib/connectors';
import { FORM_EMBED_JS, formIframeHtml } from './lib/formEmbed';
import { hashClientIp } from './lib/forms';
import { parseBeacon, readCapped, trackingScript } from './lib/tracking';
import {
  CEILING_NOTE_MS,
  LINK_GRANT_PARAM,
  MAX_BEACON_BYTES,
  VISITOR_ID_RE,
} from './_lib/validators/tracking';
import { clientIpOf, enforceRateLimit } from './lib/rateLimits';
import type { CampaignEventType } from './schema';

const http = httpRouter();

/** The header keeps the account secret out of URLs and logs; Brevo's per-message SMS `webUrl` cannot send headers, so that path has its own query-string secret. */
function authorizeWebhook(request: Request, secrets: { header?: string; query?: string }): boolean {
  const headerValue = request.headers.get('x-webhook-secret');
  if (secrets.header && headerValue && timingSafeEqual(headerValue, secrets.header)) {
    return true;
  }
  const queryValue = new URL(request.url).searchParams.get('secret');
  return !!(secrets.query && queryValue && timingSafeEqual(queryValue, secrets.query));
}

// Hit by the per-message `webUrl` (query-string secret) and by the account-level inbound registration (header secret); always 200 so Brevo does not retry.
http.route({
  path: '/webhooks/brevo/sms',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = await resolveBrevo(cfg);
    if (
      !brevo.webhookSecret ||
      !authorizeWebhook(request, { header: brevo.webhookSecret, query: brevo.smsWebhookSecret })
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    const event = (await request.json().catch(() => null)) as {
      msg_status?: string;
      messageId?: number | string;
      // The recipient phone, on inbound events (STOP, reply): it finds the lead when the messageId is a fresh inbound one.
      to?: number | string;
      // Unix seconds: the event's own time orders the timeline and sets the first-only markers.
      ts_event?: number;
    } | null;

    if (event?.msg_status && (event.messageId !== undefined || event.to !== undefined)) {
      await ctx.runMutation(internal.features.crm.internal.handleSmsEvent, {
        brevoMessageId: event.messageId !== undefined ? String(event.messageId) : undefined,
        recipient: event.to !== undefined ? String(event.to) : undefined,
        msgStatus: event.msg_status,
        eventAt: typeof event.ts_event === 'number' ? event.ts_event * 1000 : Date.now(),
      });
    }

    return new Response(null, { status: 200 });
  }),
});

/** Brevo's payloads vary between snake_case and camelCase, so both spellings are accepted; an unmapped event is acknowledged and dropped. */
const BREVO_EMAIL_EVENT_TYPE: Record<string, CampaignEventType> = {
  delivered: 'delivered',
  opened: 'opened',
  unique_opened: 'opened',
  uniqueOpened: 'opened',
  click: 'clicked',
  hard_bounce: 'hard_bounce',
  hardBounce: 'hard_bounce',
  soft_bounce: 'soft_bounce',
  softBounce: 'soft_bounce',
  spam: 'spam',
  complaint: 'spam',
  unsubscribed: 'unsubscribed',
  blocked: 'blocked',
  invalid: 'invalid',
  invalid_email: 'invalid',
  error: 'error',
};

// Always 200 on valid auth, a non-2xx makes Brevo retry for ever; the query-string secret only serves a registration older than the header.
http.route({
  path: '/webhooks/brevo/email',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = await resolveBrevo(cfg);
    if (
      !brevo.webhookSecret ||
      !authorizeWebhook(request, { header: brevo.webhookSecret, query: brevo.webhookSecret })
    ) {
      return new Response('Unauthorized', { status: 401 });
    }
    // Email does not go through Brevo: acknowledge and drop, so a stale Brevo registration cannot write events under SMTP mode.
    if (!brevo.emailIsBrevo) {
      return new Response(null, { status: 200 });
    }

    const event = (await request.json().catch(() => null)) as {
      event?: string;
      'message-id'?: string;
      ts_epoch?: number; // ms
      ts_event?: number; // seconds
      link?: string;
      reason?: string;
    } | null;

    const type = event?.event ? BREVO_EMAIL_EVENT_TYPE[event.event] : undefined;
    const messageId = event?.['message-id'];
    if (type && messageId) {
      await ctx.runMutation(internal.features.crm.internal.recordBrevoEmailEvent, {
        brevoMessageId: messageId,
        type,
        eventAt:
          event?.ts_epoch ?? (event?.ts_event !== undefined ? event.ts_event * 1000 : Date.now()),
        url: event?.link,
        reason: event?.reason,
      });
    }

    return new Response(null, { status: 200 });
  }),
});

/** Minimal French page for tracked-link responses (no-redirect thanks / 404). */
function htmlResponse(message: string, status: number): Response {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WAP CRM</title></head><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a"><p style="font-size:1.125rem;padding:0 1.5rem;text-align:center">${message}</p></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// The per-recipient tracked link is public by design: the token is the secret.
http.route({
  pathPrefix: '/l/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!(await enforceRateLimit(ctx, 'trackedLink', clientIpOf(request)))) {
      return htmlResponse('Trop de requêtes, réessayez dans un instant.', 429);
    }
    const token = new URL(request.url).pathname.slice('/l/'.length);
    // The link's own token never reaches the landing URL: a one-time value does, and only its hash is kept.
    const grant = randomToken();
    const result = token
      ? await ctx.runMutation(internal.features.crm.internal.handleTrackedLinkClick, {
          token,
          grantHash: await sha256Base64Url(grant),
        })
      : { found: false as const, redirectUrl: undefined };

    if (!result.found) return htmlResponse('Lien invalide ou expiré.', 404);
    if (result.redirectUrl) {
      const location = result.identify
        ? withLinkParam(result.redirectUrl, grant)
        : result.redirectUrl;
      return new Response(null, { status: 302, headers: { Location: location } });
    }
    return htmlResponse('Merci, vous pouvez fermer cet onglet.', 200);
  }),
});

// Where the provider, or a callback dispatcher (OAUTH_CALLBACK_BASE), sends the browser back: the code is exchanged here, the integrations page claims the account.
http.route({
  path: '/connectors/callback',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const params = new URL(request.url).searchParams;
    const back = (suffix: string) =>
      new Response(null, {
        status: 302,
        headers: {
          Location: `${appOrigin()}/settings/integrations${suffix}`,
          'Cache-Control': 'no-store',
        },
      });
    const code = params.get('code');
    const state = params.get('state');
    const failedWith = (error: string) => back(`?error=${encodeURIComponent(error)}`);
    // The user refused, or the provider failed.
    if (!code || !state) {
      const error = (params.get('error') ?? 'missing_code').slice(0, 100);
      const description = providerErrorDescription(params.get('error_description'));
      const payload = state && description ? await verifyState(state) : null;
      if (!payload || !description) return failedWith(error);
      // Free text never travels in the page's address, which anyone can craft: it waits behind a one-time token for the user who started.
      const failed = randomToken();
      const parked = await ctx.runMutation(internal.features.connectors.internal.failFromState, {
        nonce: payload.n,
        tokenHash: await sha256Base64Url(failed),
        provider: payload.p,
        error,
        description,
      });
      return parked ? back(`#failed=${failed}`) : failedWith(error);
    }
    try {
      const outcome = await ctx.runAction(internal.features.connectors.actions.completeConnection, {
        code,
        state,
      });
      // No session reaches this origin: the page finishes the connection, signed in. A fragment reaches no server log nor referrer.
      if (outcome.ok) return back(`#finish=${outcome.finish}`);
      return outcome.failed ? back(`#failed=${outcome.failed}`) : failedWith(outcome.error);
    } catch (e) {
      console.error('[connectors] callback failed', e);
      return failedWith('internal');
    }
  }),
});

/** Forms are embedded on third-party pages: every response is CORS-open. */
const FORM_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const formJson = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...FORM_CORS },
  });

// The public capture-form surface: the page for an iframe, the script for an external page, and the definition the two render.
http.route({
  pathPrefix: '/forms/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const [formId, rest, extra] = url.pathname.slice('/forms/'.length).split('/');
    if (!formId || extra !== undefined) return new Response('Not found', { status: 404 });

    if (rest === undefined) {
      return new Response(formIframeHtml(formId), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // The page loads its own script and posts to its own origin; styles are set from the script.
          'Content-Security-Policy':
            "default-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *",
        },
      });
    }
    if (rest === 'embed.js') {
      return new Response(FORM_EMBED_JS, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
          ...FORM_CORS,
        },
      });
    }
    if (rest === 'def') {
      if (!(await enforceRateLimit(ctx, 'formRender', clientIpOf(request)))) {
        return formJson({ error: 'rate_limited' }, 429);
      }
      const def = await ctx.runQuery(internal.features.forms.internal.getPublicForm, {
        formId,
        visitorToken: url.searchParams.get('visitor') ?? undefined,
      });
      if (!def) return formJson({ error: 'not_found' }, 404);
      return formJson(def, 200);
    }
    return new Response('Not found', { status: 404 });
  }),
});

http.route({
  pathPrefix: '/forms/',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const [formId, rest, extra] = url.pathname.slice('/forms/'.length).split('/');
    if (!formId || rest !== 'submit' || extra !== undefined) {
      return new Response('Not found', { status: 404 });
    }
    const ip = clientIpOf(request);
    if (
      !(await enforceRateLimit(ctx, 'formSubmit', ip)) ||
      !(await enforceRateLimit(ctx, 'formSubmitPerForm', formId)) ||
      !(await enforceRateLimit(ctx, 'formSubmitTotal', 'all'))
    ) {
      return formJson({ ok: false, code: 'rate_limited' }, 429);
    }
    const body = (await request.json().catch(() => null)) as {
      values?: Record<string, unknown>;
      consent?: boolean;
      honeypot?: string;
      renderedAt?: number;
      renderSig?: string;
      visitorToken?: string;
      trackingVisitor?: string;
    } | null;
    if (!body || typeof body.values !== 'object' || body.values === null) {
      return formJson({ ok: false, code: 'invalid_body' }, 400);
    }
    const result = await ctx.runMutation(internal.features.forms.internal.submitForm, {
      formId,
      values: Object.fromEntries(
        Object.entries(body.values).filter(
          ([, value]) =>
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            (Array.isArray(value) && value.every((item) => typeof item === 'string')),
        ),
      ) as Record<string, string | number | boolean | string[]>,
      consent: body.consent === true,
      honeypot: typeof body.honeypot === 'string' ? body.honeypot : undefined,
      renderedAt: typeof body.renderedAt === 'number' ? body.renderedAt : undefined,
      renderSig: typeof body.renderSig === 'string' ? body.renderSig : undefined,
      trackingVisitor:
        typeof body.trackingVisitor === 'string' && VISITOR_ID_RE.test(body.trackingVisitor)
          ? body.trackingVisitor
          : undefined,
      visitorToken: typeof body.visitorToken === 'string' ? body.visitorToken : undefined,
      ipHash: await hashClientIp(ip),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
    if (!result.ok) return formJson(result, result.code === 'not_found' ? 404 : 400);
    return formJson(result, 200);
  }),
});

// Cross-origin preflight for the JSON submit POST.
http.route({
  pathPrefix: '/forms/',
  method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers: FORM_CORS })),
});

/** The click's one-time value as a query parameter of the landing URL, for the tracking script. */
function withLinkParam(url: string, grant: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(LINK_GRANT_PARAM, grant);
    return u.toString();
  } catch {
    return url;
  }
}

// Web tracking: the script and the beacons, public; the script runs on the customer's site and starts nothing before consent.
http.route({
  path: '/track.js',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const config = await ctx.runQuery(internal.features.config.internal.getTrackingConfig, {});
    return new Response(trackingScript(new URL(request.url).origin, config), {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        ...FORM_CORS,
      },
    });
  }),
});

const beaconResponse = (status: number) => new Response(null, { status, headers: FORM_CORS });

http.route({
  path: '/track',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    // Global Privacy Control and Do Not Track are honoured here as well as in the script.
    if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') {
      return beaconResponse(204);
    }
    if (!(await enforceRateLimit(ctx, 'trackBeacon', clientIpOf(request)))) {
      return beaconResponse(429);
    }
    const config = await ctx.runQuery(internal.features.config.internal.getTrackingConfig, {});
    if (!config.enabled) return beaconResponse(204);
    // Only the sites the script was set up for; a browser always says where a beacon comes from.
    const origin = request.headers.get('origin');
    if (!origin || !config.allowedOrigins.includes(origin)) return beaconResponse(403);
    // sendBeacon posts text/plain: the body is read as text whatever the header says.
    const text = await readCapped(request, MAX_BEACON_BYTES);
    if (text === null) return beaconResponse(413);
    const beacon = parseBeacon(text, origin, Date.now());
    if (!beacon) return beaconResponse(400);
    if (beacon.views.length === 0) return beaconResponse(204);
    if (!(await enforceRateLimit(ctx, 'trackVisitor', beacon.visitorId))) {
      return beaconResponse(429);
    }
    // For the whole deployment, counted in views: many addresses still meet a ceiling.
    if (!(await enforceRateLimit(ctx, 'trackTotal', 'all', beacon.views.length))) {
      // Views are being lost: the settings page says so, from one write an hour at most.
      if ((config.ceilingHitAt ?? 0) < Date.now() - CEILING_NOTE_MS) {
        await ctx.runMutation(internal.features.tracking.internal.noteCeiling, {});
      }
      return beaconResponse(429);
    }
    await ctx.runMutation(internal.features.tracking.internal.recordBeacon, {
      visitorId: beacon.visitorId,
      views: beacon.views,
      grantHash: beacon.grant ? await sha256Base64Url(beacon.grant) : undefined,
    });
    return beaconResponse(204);
  }),
});

http.route({
  path: '/track',
  method: 'OPTIONS',
  handler: httpAction(async () => beaconResponse(204)),
});

// Public REST API (/api/v1/): see features/api/routes.ts.
extensions.registerHttpRoutes(http);
registerApiRoutes(http);

// `cors: true` lets the SPA, served from another origin than this deployment, call `/api/auth/*`; the allowed origins are the `trustedOrigins` of `createAuth`.
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
