import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { AppConfig } from './_lib/validators/appConfig';
import { addSend, emptyStats } from './lib/campaigns/stats';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './lib/security/crypto';

// Online migrations (@convex-dev/migrations): `bunx convex run migrations:run '{"fn":"migrations:<name>"}'`.
export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

type Rewrite = (value: string) => Promise<string>;

/** Every stored secret of a config document rewritten through `rewrite`; absent fields stay absent. */
async function rewriteSecrets(config: AppConfig, rewrite: Rewrite): Promise<Partial<AppConfig>> {
  const auth = { ...config.auth };
  if (config.auth.ssoProviders) {
    auth.ssoProviders = await Promise.all(
      config.auth.ssoProviders.map(async (p) => ({
        ...p,
        clientSecret: await rewrite(p.clientSecret),
      })),
    );
  }
  if (config.auth.socialProviders) {
    auth.socialProviders = await Promise.all(
      config.auth.socialProviders.map(async (p) => ({
        ...p,
        clientSecret: await rewrite(p.clientSecret),
      })),
    );
  }
  const connectors = config.connectors
    ? {
        connectors: await Promise.all(
          config.connectors.map(async (c) => ({
            ...c,
            clientSecret: await rewrite(c.clientSecret),
          })),
        ),
      }
    : {};
  if (!config.email) return { auth, ...connectors };
  const email = { ...config.email };
  for (const field of ['brevoApiKey', 'brevoWebhookSecret', 'smtpPass'] as const) {
    const value = config.email[field];
    if (value !== undefined) email[field] = await rewrite(value);
  }
  return { auth, email, ...connectors };
}

/** Secrets written before SECRETS_KEY existed become ciphertext; already encrypted ones are left alone. */
export const encryptAppConfigSecrets = migrations.define({
  table: 'appConfig',
  migrateOne: async (_ctx, config) =>
    await rewriteSecrets(config, async (value) =>
      value && !isEncryptedSecret(value) ? await encryptSecret(value) : value,
    ),
});

/** Rotation: everything re-encrypted with SECRETS_KEY_NEXT (decrypted with either key first). */
export const rotateAppConfigSecrets = migrations.define({
  table: 'appConfig',
  migrateOne: async (_ctx, config) =>
    await rewriteSecrets(config, async (value) =>
      value ? await encryptSecret(await decryptSecret(value)) : value,
    ),
});

/** Connector tokens follow the same two steps as the config's secrets: encrypt what was written in clear, then rotate. */
export const encryptConnectorTokens = migrations.define({
  table: 'connectorAccounts',
  migrateOne: async (_ctx, account) => ({
    refreshToken: isEncryptedSecret(account.refreshToken)
      ? account.refreshToken
      : await encryptSecret(account.refreshToken),
    ...(account.accessToken && !isEncryptedSecret(account.accessToken)
      ? { accessToken: await encryptSecret(account.accessToken) }
      : {}),
  }),
});

export const rotateConnectorTokens = migrations.define({
  table: 'connectorAccounts',
  migrateOne: async (_ctx, account) => ({
    refreshToken: await encryptSecret(await decryptSecret(account.refreshToken)),
    ...(account.accessToken
      ? { accessToken: await encryptSecret(await decryptSecret(account.accessToken)) }
      : {}),
  }),
});

/** The counters of the campaigns written before they existed: every campaign reset, then every send counted. Run `backfillCampaignStats` while no campaign is being sent: a send changing between the two passes would count twice. */
export const resetCampaignStats = migrations.define({
  table: 'campaigns',
  migrateOne: () => ({ stats: emptyStats() }),
});

export const countCampaignSends = migrations.define({
  table: 'campaignSends',
  migrateOne: async (ctx, send) => {
    const campaign = await ctx.db.get(send.campaignId);
    if (!campaign) return;
    await ctx.db.patch(campaign._id, { stats: addSend(campaign.stats ?? emptyStats(), send, 1) });
  },
});

export const backfillCampaignStats = migrations.runner([
  internal.migrations.resetCampaignStats,
  internal.migrations.countCampaignSends,
]);
