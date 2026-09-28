/** The deployment's `.convex.site` origin: the explicit setting, else derived from the Convex URL. */
export function convexSiteUrl(): string {
  const env = (typeof window !== 'undefined' && window.__ENV__) || {};
  const explicit = env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const convexUrl = String(env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL ?? '');
  return convexUrl.replace(/\.convex\.cloud\/?$/, '.convex.site').replace(/\/+$/, '');
}
