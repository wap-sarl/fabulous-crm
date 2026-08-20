import { useEffect } from 'react';
import { usePublicConfig } from './ConfigContext';
import { applyPrimaryColor, resetPrimaryColor } from './applyThemeColor';

/**
 * Applies runtime branding to the document head: swaps the favicon to the
 * uploaded one, sets the tab title to the organization name, and overrides the
 * `--primary` accent color when one is configured. Renders nothing. Falls back
 * to the static `/favicon.svg` (index.html), "CRM", and the theme.css default
 * color when unset. Mount once inside `PublicConfigProvider`.
 */
export function BrandingHead() {
  const { config } = usePublicConfig();
  const faviconUrl = config?.faviconUrl ?? null;
  const organizationName = config?.organizationName ?? null;
  const primaryColor = config?.primaryColor ?? null;

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl ?? '/favicon.svg';
    // Drop the explicit SVG type when swapping to an uploaded raster favicon so
    // the browser sniffs the real content type.
    if (faviconUrl) link.removeAttribute('type');
    else link.type = 'image/svg+xml';
  }, [faviconUrl]);

  useEffect(() => {
    if (organizationName) document.title = organizationName;
  }, [organizationName]);

  useEffect(() => {
    if (primaryColor) applyPrimaryColor(primaryColor);
    else resetPrimaryColor();
  }, [primaryColor]);

  return null;
}
