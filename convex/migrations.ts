import { Migrations } from '@convex-dev/migrations';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './lib/crypto';
import type { AppConfig } from './_lib/validators/appConfig';

export const migrations = new Migrations<DataModel>(components.migrations);
export const run = migrations.runner();

/** Every stored secret of a config document rewritten through `rewrite`, untouched fields kept. */
async function rewriteSecrets(
  config: AppConfig,
  rewrite: (value: string) => Promise<string>,
): Promise<Partial<AppConfig>> {
  const auth = {
    ...config.auth,
    ssoProviders: config.auth.ssoProviders
      ? await Promise.all(
          config.auth.ssoProviders.map(async (p) => ({
            ...p,
            clientSecret: await rewrite(p.clientSecret),
          })),
        )
      : undefined,
    socialProviders: config.auth.socialProviders
      ? await Promise.all(
          config.auth.socialProviders.map(async (p) => ({
            ...p,
            clientSecret: await rewrite(p.clientSecret),
          })),
        )
      : undefined,
  };
  const email = config.email
    ? {
        ...config.email,
        brevoApiKey: await rewrite(config.email.brevoApiKey ?? ''),
        brevoWebhookSecret: await rewrite(config.email.brevoWebhookSecret ?? ''),
        smtpPass: await rewrite(config.email.smtpPass ?? ''),
      }
    : undefined;
  return { auth, ...(email ? { email } : {}) };
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
