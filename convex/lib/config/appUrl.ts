/** An env var and not `appConfig.appUrl`: Better Auth resolves `trustedOrigins` on an empty ctx that cannot read the DB; `CRM_APP_URL` is the deprecated fallback. */
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
