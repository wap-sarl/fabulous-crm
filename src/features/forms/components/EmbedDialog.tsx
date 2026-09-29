import type { Id } from '@crm/lib/backend';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@crm/design-system';
import { convexSiteUrl } from '../../../lib/convexSite';
import { CopyRow } from './CopyRow';

/** Script tag + iframe URL of a saved form. */
export function EmbedDialog({ formId, onClose }: { formId: Id<'forms'>; onClose: () => void }) {
  const base = convexSiteUrl();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Intégrer le formulaire</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <CopyRow
            label="Script à insérer dans une page externe"
            value={`<script src="${base}/forms/${formId}/embed.js"></script>`}
          />
          <CopyRow label="URL de la page autonome (iframe)" value={`${base}/forms/${formId}`} />
          <p className="text-xs text-faint">
            Le script injecte le formulaire à l’endroit où il est placé (ou dans l’élément désigné
            par son attribut <code>data-target</code>). Styles isolés de la page hôte. Avec un
            gestionnaire de balises (Google Tag Manager), indiquez l’élément cible avec{' '}
            <code>data-target</code> : le script ne sait pas où il a été inséré.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
