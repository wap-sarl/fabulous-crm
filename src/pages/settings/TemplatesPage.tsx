import { useState } from 'react';
import { useAuth, useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  PageHeader,
  StatusBadge,
  cn,
  toast,
} from '@crm/design-system';
import { Copy, Eye, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { CampaignMessagePreview } from '../../features/campaigns/components/CampaignMessagePreview';
import { SnippetDialog } from '../../features/templates/components/SnippetDialog';
import { TemplateDialog } from '../../features/templates/components/TemplateDialog';
import { TemplateUsage } from '../../features/templates/components/TemplateUsage';
import { useEmailTemplates } from '../../features/templates/hooks/useEmailTemplates';
import { useSnippets } from '../../features/templates/hooks/useSnippets';
import { TEMPLATE_SCOPE_LABEL, TEMPLATE_SCOPE_TONE } from '../../features/templates/lib/constants';
import { templateErrorMessage } from '../../features/templates/lib/errors';
import { categoriesOf, filterTemplates } from '../../features/templates/lib/search';
import type { EmailTemplateRow, SnippetRow } from '../../features/templates/types';
import { dateFormat } from '@crm/lib/format';

/** Settings → Modèles: the e-mail library everyone reads within their reach, and the text blocks typed by shortcut. */
export function TemplatesPage() {
  usePageTitle('Modèles');
  const { user } = useAuth();
  const canSeed = !!user?.access?.settings;
  const templates = useEmailTemplates();
  const snippets = useSnippets();
  const duplicateTemplate = useAuthMutation(
    api.features.emailTemplates.mutations.duplicateEmailTemplate,
  );
  const deleteTemplate = useAuthMutation(api.features.emailTemplates.mutations.deleteEmailTemplate);
  const ensureDefaults = useAuthMutation(api.features.emailTemplates.mutations.ensureDefaults);
  const deleteSnippet = useAuthMutation(api.features.snippets.mutations.deleteSnippet);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toEdit, setToEdit] = useState<EmailTemplateRow | null>(null);
  const [toPreview, setToPreview] = useState<EmailTemplateRow | null>(null);
  const [toDelete, setToDelete] = useState<EmailTemplateRow | null>(null);
  const [snippetEditorOpen, setSnippetEditorOpen] = useState(false);
  const [snippetToEdit, setSnippetToEdit] = useState<SnippetRow | null>(null);
  const [snippetToDelete, setSnippetToDelete] = useState<SnippetRow | null>(null);

  const categories = categoriesOf(templates);
  const shown = filterTemplates(templates, search, category);

  const duplicate = async (template: EmailTemplateRow) => {
    try {
      await duplicateTemplate({ templateId: template._id });
      toast.success('Copie créée, privée.');
    } catch (error) {
      toast.error(templateErrorMessage(error, 'Échec de la copie.'));
    }
  };

  const seed = async () => {
    try {
      const count = await ensureDefaults({});
      toast.success(`${count} modèle(s) créé(s).`);
    } catch (error) {
      toast.error(templateErrorMessage(error, 'Échec de la création.'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Modèles"
        subtitle="Les e-mails réutilisables de la bibliothèque, chargés dans les campagnes et les workflows, et les blocs de texte tapés par raccourci dans l’éditeur"
        actions={
          <Button
            onClick={() => {
              setToEdit(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nouveau modèle
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
          <Input
            type="search"
            placeholder="Rechercher un modèle"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
        {categories.length > 0 && (
          <fieldset className="flex flex-wrap gap-1.5">
            <legend className="sr-only">Catégories</legend>
            <CategoryChip
              label="Toutes"
              active={category === undefined}
              onClick={() => setCategory(undefined)}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c}
                label={c}
                active={category === c}
                onClick={() => setCategory(c)}
              />
            ))}
          </fieldset>
        )}
      </div>

      <div className="mt-4">
        {templates.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-soft">Aucun modèle dans votre périmètre.</p>
            {canSeed && (
              <Button variant="outline" onClick={seed}>
                Créer les modèles par défaut
              </Button>
            )}
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-soft">Aucun modèle ne correspond.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {shown.map((template) => (
              <li key={template._id} className="flex items-center gap-2 px-3 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{template.name}</span>
                    <StatusBadge tone={TEMPLATE_SCOPE_TONE[template.scope]} withDot={false}>
                      {TEMPLATE_SCOPE_LABEL[template.scope]}
                    </StatusBadge>
                    {template.category && (
                      <StatusBadge tone="gray" withDot={false}>
                        {template.category}
                      </StatusBadge>
                    )}
                  </span>
                  <span className="truncate text-xs text-soft">
                    {template.subject}
                    {template.ownerName ? ` · ${template.ownerName}` : ''} ·{' '}
                    {dateFormat.format(template.updatedAt)}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToPreview(template)}
                  aria-label={`Prévisualiser ${template.name}`}
                >
                  <Eye className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => duplicate(template)}
                  aria-label={`Dupliquer ${template.name}`}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
                {template.editable && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToEdit(template)}
                      aria-label={`Modifier ${template.name}`}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToDelete(template)}
                      aria-label={`Supprimer ${template.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <section className="mt-10">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-ink">Blocs de texte</h2>
            <p className="text-sm text-soft">
              Tapez leur raccourci dans l’éditeur, précédé de /, pour insérer le texte.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setSnippetToEdit(null);
              setSnippetEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nouveau bloc
          </Button>
        </div>
        <div className="mt-4">
          {snippets.length === 0 ? (
            <p className="text-sm text-soft">Aucun bloc de texte.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {snippets.map((snippet) => (
                <li key={snippet._id} className="flex items-center gap-2 px-3 py-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{snippet.name}</span>
                      <span className="font-mono text-xs text-faint">{snippet.shortcut}</span>
                    </span>
                    <span className="line-clamp-1 text-xs text-soft">{snippet.text}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSnippetToEdit(snippet)}
                    aria-label={`Modifier ${snippet.name}`}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSnippetToDelete(snippet)}
                    aria-label={`Supprimer ${snippet.name}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {(editorOpen || toEdit) && (
        <TemplateDialog
          template={toEdit}
          categories={categories}
          onClose={() => {
            setEditorOpen(false);
            setToEdit(null);
          }}
        />
      )}
      {toPreview && (
        <Dialog open onOpenChange={(open) => !open && setToPreview(null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{toPreview.name}</DialogTitle>
            </DialogHeader>
            <TemplateUsage templateId={toPreview._id} />
            <CampaignMessagePreview
              channel="email"
              subject={toPreview.subject}
              html={toPreview.htmlBody}
              className="h-[50vh]"
            />
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Supprimer « ${toDelete?.name ?? ''} » ?`}
        description="Les campagnes et les workflows qui l’ont chargé gardent leur copie et leurs chiffres."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteTemplate({ templateId: toDelete._id });
            toast.success('Modèle supprimé.');
          } catch (error) {
            toast.error(templateErrorMessage(error, 'Échec de la suppression.'));
          } finally {
            setToDelete(null);
          }
        }}
      />
      {(snippetEditorOpen || snippetToEdit) && (
        <SnippetDialog
          snippet={snippetToEdit}
          onClose={() => {
            setSnippetEditorOpen(false);
            setSnippetToEdit(null);
          }}
        />
      )}
      <ConfirmDialog
        open={snippetToDelete !== null}
        onOpenChange={(open) => !open && setSnippetToDelete(null)}
        title={`Supprimer « ${snippetToDelete?.name ?? ''} » ?`}
        description="Le raccourci n’insérera plus rien ; les e-mails déjà écrits ne changent pas."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!snippetToDelete) return;
          try {
            await deleteSnippet({ snippetId: snippetToDelete._id });
            toast.success('Bloc supprimé.');
          } catch (error) {
            toast.error(templateErrorMessage(error, 'Échec de la suppression.'));
          } finally {
            setSnippetToDelete(null);
          }
        }}
      />
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-border text-soft hover:bg-muted hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
