import { useEffect } from 'react';
import { usePublicConfig } from './ConfigContext';
import { applyPrimaryColor, resetPrimaryColor } from './applyThemeColor';

/** Applies the runtime branding to the document and renders nothing; mount it once, inside `PublicConfigProvider`. */
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
    // An uploaded favicon may be a raster image: without the explicit SVG type, the browser sniffs the real one.
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
