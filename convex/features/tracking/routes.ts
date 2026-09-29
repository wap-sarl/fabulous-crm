import type { HttpRouter } from 'convex/server';
import { httpAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { sha256Base64Url } from '../../lib/security/crypto';
import { trackingScript } from '../../lib/tracking/script';
import { parseBeacon } from '../../lib/tracking/beacon';
import { readCapped } from '../../lib/http/body';
import { CEILING_NOTE_MS, MAX_BEACON_BYTES } from '../../_lib/validators/tracking';
import { clientIpOf, enforceRateLimit } from '../../lib/security/rateLimits';
import { PUBLIC_CORS } from '../../lib/http/cors';

const beaconResponse = (status: number) => new Response(null, { status, headers: PUBLIC_CORS });

export function registerTrackingRoutes(http: HttpRouter): void {
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
          ...PUBLIC_CORS,
        },
      });
    }),
  });

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
}
