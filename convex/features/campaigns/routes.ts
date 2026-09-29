import type { HttpRouter } from 'convex/server';
import { httpAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { resolveBrevo } from '../../lib/email/provider';
import { timingSafeEqual } from '../../lib/security/crypto';
import { randomToken, sha256Base64Url } from '../../lib/security/crypto';
import { LINK_GRANT_PARAM } from '../../_lib/validators/tracking';
import { clientIpOf, enforceRateLimit } from '../../lib/security/rateLimits';
import type { CampaignEventType } from '../../schema';

/** The header keeps the account secret out of URLs and logs; Brevo's per-message SMS `webUrl` cannot send headers, so that path has its own query-string secret. */
function authorizeWebhook(request: Request, secrets: { header?: string; query?: string }): boolean {
  const headerValue = request.headers.get('x-webhook-secret');
  if (secrets.header && headerValue && timingSafeEqual(headerValue, secrets.header)) {
    return true;
  }
  const queryValue = new URL(request.url).searchParams.get('secret');
  return !!(secrets.query && queryValue && timingSafeEqual(queryValue, secrets.query));
}

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

/** Minimal French page for tracked-link responses (no-redirect thanks / 404). */
function htmlResponse(message: string, status: number): Response {
  const body = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WAP CRM</title></head><body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a"><p style="font-size:1.125rem;padding:0 1.5rem;text-align:center">${message}</p></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

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

export function registerCampaignsRoutes(http: HttpRouter): void {
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
        await ctx.runMutation(internal.features.campaigns.internal.handleSmsEvent, {
          brevoMessageId: event.messageId !== undefined ? String(event.messageId) : undefined,
          recipient: event.to !== undefined ? String(event.to) : undefined,
          msgStatus: event.msg_status,
          eventAt: typeof event.ts_event === 'number' ? event.ts_event * 1000 : Date.now(),
        });
      }

      return new Response(null, { status: 200 });
    }),
  });

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
        await ctx.runMutation(internal.features.campaigns.internal.recordBrevoEmailEvent, {
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
        ? await ctx.runMutation(internal.features.campaigns.internal.handleTrackedLinkClick, {
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
}
