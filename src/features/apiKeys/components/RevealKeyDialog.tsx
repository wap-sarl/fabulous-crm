import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@crm/design-system';
import { Copy } from 'lucide-react';

/** One-time reveal of a freshly created key — it can never be displayed again. */
export function RevealKeyDialog({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const copy = async () => {
    await navigator.clipboard.writeText(apiKey);
    toast.success('Clé copiée.');
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clé d’API créée</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-soft">
          Copiez cette clé maintenant et stockez-la en lieu sûr :{' '}
          <span className="font-medium text-ink">elle ne sera plus jamais affichée.</span>
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{apiKey}</code>
          <Button variant="ghost" size="sm" onClick={copy} aria-label="Copier la clé">
            <Copy className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
