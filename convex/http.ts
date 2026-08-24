import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { authComponent, createAuth } from './auth';
import { resolveBrevo, timingSafeEqual } from './lib';
import { clientIpOf, enforceRateLimit } from './lib/rateLimits';
import type { CampaignEventType } from './schema';

const http = httpRouter();

/**
 * Webhook authentication (#18). Two delivery paths, two mechanisms:
 * - Account-level webhooks (email, and the inbound-SMS registration) carry the
 *   secret in the `x-webhook-secret` header, set at registration — it never
 *   appears in URLs, proxy logs, or Brevo's webhook listing.
 * - Brevo's per-message SMS `webUrl` cannot send headers, so that one path
 *   keeps a query-string secret — a DEDICATED one (BREVO_SMS_WEBHOOK_SECRET,
 *   falling back to the shared secret), so its exposure in URLs never burns
 *   the account-level secret and it rotates independently.
 * All comparisons are constant-time (timingSafeEqual). The query-string
 * fallback on the email route only eases the migration of a registration
 * predating the header — re-run registerBrevoEmailWebhook to move off it.
 */
function authorizeWebhook(request: Request, secrets: { header?: string; query?: string }): boolean {
  const headerValue = request.headers.get('x-webhook-secret');
  if (secrets.header && headerValue && timingSafeEqual(headerValue, secrets.header)) {
    return true;
  }
  const queryValue = new URL(request.url).searchParams.get('secret');
  return !!(secrets.query && queryValue && timingSafeEqual(queryValue, secrets.query));
}

// Brevo SMS event webhook: hit by the per-message `webUrl` (outbound lifecycle,
// query-string secret) and by the account-level inbound registration (STOP,
// replies — header secret). Every event with a messageId is forwarded to
// handleSmsEvent; unknown statuses are dropped there. Always 200 so Brevo does
// not retry.
http.route({
  path: '/webhooks/brevo/sms',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = resolveBrevo(cfg);
    if (
      !brevo.webhookSecret ||
      !authorizeWebhook(request, { header: brevo.webhookSecret, query: brevo.smsWebhookSecret })
    ) {
      return new Response('Unauthorized', { status: 401 });
    }

    const event = (await request.json().catch(() => null)) as {
      msg_status?: string;
      messageId?: number | string;
      // Recipient phone (present on inbound events like STOP/replied) — used to
      // correlate back to the lead when the messageId is a fresh inbound one.
      to?: number | string;
      // Unix seconds when the event occurred (Brevo). Used for accurate timeline
      // ordering + first-only metric markers; falls back to now if absent.
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

/**
 * Brevo transactional-email event names → our campaignEvents types. Brevo's
 * docs and payloads vary between snake_case and camelCase, so both spellings
 * are accepted. Unmapped events (proxy_open, loaded_by_proxy, deferred,
 * request…) are ACKed and dropped. `unique_opened` maps to 'opened' defensively
 * — we only subscribe to `opened` (see registerBrevoEmailWebhook).
 */
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

// Brevo transactional-email webhook (account-level, registered once via
// registerBrevoEmailWebhook). Correlated to the send by `message-id`. Always
// 200 on valid auth — a non-2xx would make Brevo retry forever.
http.route({
  path: '/webhooks/brevo/email',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    const brevo = resolveBrevo(cfg);
    if (
      !brevo.webhookSecret ||
      !authorizeWebhook(request, { header: brevo.webhookSecret, query: brevo.webhookSecret })
    ) {
      return new Response('Unauthorized', { status: 401 });
    }
    // Email tracking is disabled when email isn't going through Brevo: ACK and
    // drop so a stale Brevo registration can't write events under SMTP mode.
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

// Per-recipient tracked campaign link (see campaignLinkTokens). Public by
// design — the token is the secret. Applies the link's property update, then
// 302-redirects to the configured URL or shows a French "close this tab" page.
http.route({
  pathPrefix: '/l/',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    if (!(await enforceRateLimit(ctx, 'trackedLink', clientIpOf(request)))) {
      return htmlResponse('Trop de requêtes, réessayez dans un instant.', 429);
    }
    const token = new URL(request.url).pathname.slice('/l/'.length);
    const result = token
      ? await ctx.runMutation(internal.features.crm.internal.handleTrackedLinkClick, { token })
      : { found: false as const, redirectUrl: undefined };

    if (!result.found) return htmlResponse('Lien invalide ou expiré.', 404);
    if (result.redirectUrl) {
      return new Response(null, { status: 302, headers: { Location: result.redirectUrl } });
    }
    return htmlResponse('Merci, vous pouvez fermer cet onglet.', 200);
  }),
});

// Registers Better Auth's HTTP routes (e.g. /api/auth/callback/<provider>).
// `cors: true` emits CORS headers (Access-Control-Allow-Origin from
// `trustedOrigins`, credentials allowed) so the SPA — served from a different
// origin than this `.convex.site` deployment — can call `/api/auth/*` (e.g.
// `signIn.social`). Allowed origins come from `createAuth`'s `trustedOrigins`
// (driven by the SITE_URL env var).
authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
