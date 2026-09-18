import { employeeQuery } from '../../_lib/auth';
import { CONNECTOR_PROVIDERS } from '../../_lib/validators/connectors';
import { credentialsSource, PROVIDERS } from '../../lib/connectors';

/** The integrations page: which providers can be connected, and the caller's accounts. Never a token. */
export const overview = employeeQuery({
  args: {},
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
