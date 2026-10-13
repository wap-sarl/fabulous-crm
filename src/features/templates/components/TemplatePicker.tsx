import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  StatusBadge,
  cn,
} from '@crm/design-system';
import { Search } from 'lucide-react';
import { CampaignMessagePreview } from '../../campaigns/components/CampaignMessagePreview';
import { useEmailTemplates } from '../hooks/useEmailTemplates';
import { TEMPLATE_SCOPE_LABEL, TEMPLATE_SCOPE_TONE } from '../lib/constants';
import { filterTemplates } from '../lib/search';
import type { EmailTemplateRow } from '../types';

/** The library as a choice: search, a list, the preview of the one pointed at, and « Charger ». Shared by the campaign editor, the workflow step and, later, the 1:1 e-mail. */
export function TemplatePicker({
  onPick,
  onClose,
}: {
  onPick: (template: EmailTemplateRow) => void;
  onClose: () => void;
}) {
  const templates = useEmailTemplates();
  const [search, setSearch] = useState('');
  const [currentId, setCurrentId] = useState<EmailTemplateRow['_id'] | null>(null);
  const shown = filterTemplates(templates, search);
  const current = shown.find((t) => t._id === currentId) ?? shown[0] ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Charger un modèle</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
          <Input
            type="search"
            placeholder="Rechercher un modèle (nom, objet, catégorie)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>
        <div className="grid max-h-[60vh] gap-4 sm:grid-cols-[18rem_1fr]">
          <ul className="overflow-y-auto rounded-lg border border-border" aria-label="Modèles">
            {shown.length === 0 && (
              <li className="px-3 py-4 text-sm text-soft">Aucun modèle ne correspond.</li>
            )}
            {shown.map((template) => (
              <li key={template._id}>
                <button
                  type="button"
                  onClick={() => setCurrentId(template._id)}
                  onDoubleClick={() => onPick(template)}
                  className={cn(
                    'flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left last:border-b-0',
                    current?._id === template._id ? 'bg-muted' : 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{template.name}</span>
                    <StatusBadge
                      tone={TEMPLATE_SCOPE_TONE[template.scope]}
                      withDot={false}
                      className="ml-auto"
                    >
                      {TEMPLATE_SCOPE_LABEL[template.scope]}
                    </StatusBadge>
                  </span>
                  <span className="line-clamp-1 text-xs text-soft">
                    {[template.category, template.subject].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-h-[16rem] overflow-hidden">
            {current ? (
              <CampaignMessagePreview
                channel="email"
                subject={current.subject}
                html={current.htmlBody}
                className="h-full"
              />
            ) : (
              <p className="text-sm text-soft">Choisissez un modèle pour le prévisualiser.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!current} onClick={() => current && onPick(current)}>
            Charger
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
