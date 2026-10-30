import type { StorageReader } from 'convex/server';
import type { Doc } from '../../_generated/dataModel';
import type { EmailBrand } from '../../auth/emailTemplates';
import { appOrigin } from '../config/appUrl';

/** How the deployment presents itself in a system e-mail: the branding settings, the logo resolved to its URL. */
export async function emailBrandOf(
  ctx: { storage: StorageReader },
  cfg: Doc<'appConfig'> | null | undefined,
): Promise<EmailBrand> {
  return {
    organizationName: cfg?.organizationName || 'CRM',
    logoUrl: cfg?.logoStorageId ? await ctx.storage.getUrl(cfg.logoStorageId) : null,
    primaryColor: cfg?.primaryColor ?? null,
    appUrl: (cfg?.appUrl || appOrigin()).replace(/\/+$/, ''),
  };
}
