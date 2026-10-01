import { v } from 'convex/values';
import { connectorProviderValidator } from '../../_lib/validators/connectors';
import { employeeQuery } from '../../_lib/auth';
import { CONNECTOR_PROVIDERS } from '../../_lib/validators/connectors';
import { credentialsSource, PROVIDERS } from '../../lib/connectors/oauth';

/** The integrations page: which providers can be connected, and the caller's accounts. Never a token. */
export const overview = employeeQuery({
  args: {},
  returns: v.array(
    v.object({
      provider: connectorProviderValidator,
      label: v.string(),
      source: v.union(v.literal('own'), v.literal('managed'), v.null()),
      account: v.union(
        v.object({
          email: v.union(v.string(), v.null()),
          scopes: v.array(v.string()),
          status: v.union(v.literal('active'), v.literal('error'), v.literal('revoking')),
          connectedAt: v.number(),
        }),
        v.null(),
      ),
    }),
  ),
  handler: async (ctx) => {
    const config = await ctx.db.query('appConfig').first();
    const accounts = await ctx.db
      .query('connectorAccounts')
      .withIndex('by_user_provider', (q) => q.eq('userId', ctx.userId))
      .collect();
    return CONNECTOR_PROVIDERS.map((provider) => {
      const account = accounts.find((a) => a.provider === provider && a.status !== 'revoking');
      return {
        provider,
        label: PROVIDERS[provider].label,
        // `own`: this deployment's OAuth app; `managed`: supplied by the host; null: nothing to connect with.
        source: credentialsSource(config, provider),
        account: account
          ? {
              email: account.email ?? null,
              scopes: account.scopes,
              status: account.status,
              connectedAt: account.connectedAt,
            }
          : null,
      };
    });
  },
});
