import type { HttpRouter } from 'convex/server';
import { httpAction } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { appOrigin } from '../../lib/config/appUrl';
import { providerErrorDescription, verifyState } from '../../lib/connectors/oauth';
import { randomToken, sha256Base64Url } from '../../lib/security/crypto';

export function registerConnectorsRoutes(http: HttpRouter): void {
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
        const outcome = await ctx.runAction(
          internal.features.connectors.actions.completeConnection,
          {
            code,
            state,
          },
        );
        // No session reaches this origin: the page finishes the connection, signed in. A fragment reaches no server log nor referrer.
        if (outcome.ok) return back(`#finish=${outcome.finish}`);
        return outcome.failed ? back(`#failed=${outcome.failed}`) : failedWith(outcome.error);
      } catch (e) {
        console.error('[connectors] callback failed', e);
        return failedWith('internal');
      }
    }),
  });
}
