import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { Spinner } from '@crm/design-system';

/** The page as the public route serves it, what is saved, in a frame of its own: the form inside is the real one, so nothing is sent from here. */
export function PagePreview({ pageId }: { pageId: Id<'landingPages'> }) {
  const html = useAuthQuery(api.features.landingPages.queries.previewLandingPage, { pageId });
  if (html === undefined) return <Spinner size="sm" />;
  if (html === null) return <p className="text-sm text-faint">Page introuvable.</p>;
  return (
    <iframe
      title="Aperçu de la page"
      srcDoc={html}
      sandbox="allow-scripts allow-popups"
      className="h-[70vh] w-full rounded-xl border bg-white"
    />
  );
}
