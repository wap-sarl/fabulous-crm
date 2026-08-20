/**
 * Canonical app/SPA origin(s), read from `SITE_URL` (Better Auth's convention;
 * comma-separated for several). `CRM_APP_URL` is a deprecated single-origin
 * fallback kept for backward compatibility — prefer `SITE_URL`.
 *
 * Must be an env var (not `appConfig.appUrl`): Better Auth resolves
 * `trustedOrigins`/`crossDomain` on an empty ctx that cannot read the DB.
 */
export function appOrigins(): string[] {
  const fromSiteUrl = (process.env.SITE_URL ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (fromSiteUrl.length > 0) return fromSiteUrl;

  const legacy = (process.env.CRM_APP_URL ?? '').trim().replace(/\/+$/, '');
  return legacy ? [legacy] : [];
}

/** The primary app origin (first of `SITE_URL`, else `CRM_APP_URL`); `''` if unset. */
export function appOrigin(): string {
  return appOrigins()[0] ?? '';
}
