import type { StorageReader } from 'convex/server';
import type { Doc } from '../../_generated/dataModel';
import type { EmailBrand, EmailLogo } from '../../auth/emailTemplates';
import { appOrigin } from '../config/appUrl';

/** What Gmail, Outlook and the rest all display: no SVG, no WebP. */
const MAIL_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);

/** The logo as a mail may show it: a type every client displays, with the proportions the browser read at upload; a logo of another type, or one uploaded before its type was recorded, leaves the wordmark. */
async function mailLogoOf(
  ctx: { storage: StorageReader },
  cfg: Doc<'appConfig'>,
): Promise<EmailLogo | null> {
  const image = cfg.logoImage;
  if (!cfg.logoStorageId || !image || !MAIL_IMAGE_TYPES.has(image.contentType)) return null;
  const url = await ctx.storage.getUrl(cfg.logoStorageId);
  return url ? { url, width: image.width, height: image.height } : null;
}

/** How the deployment presents itself in a system e-mail: the branding settings, the logo resolved to its URL. */
export async function emailBrandOf(
  ctx: { storage: StorageReader },
  cfg: Doc<'appConfig'> | null | undefined,
): Promise<EmailBrand> {
  return {
    organizationName: cfg?.organizationName || 'CRM',
    logo: cfg ? await mailLogoOf(ctx, cfg) : null,
    primaryColor: cfg?.primaryColor ?? null,
    appUrl: (cfg?.appUrl || appOrigin()).replace(/\/+$/, ''),
  };
}
