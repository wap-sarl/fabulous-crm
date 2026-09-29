import { useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import {
  Button,
  Card,
  ConfirmDialog,
  IconButton,
  PageHeader,
  Spinner,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Code2, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { EmbedDialog } from '../../features/forms/components/EmbedDialog';
import { FormEditorDialog } from '../../features/forms/components/FormEditorDialog';

/** Settings → Formulaires: capture forms list + visual builder. */
export function FormsPage() {
  usePageTitle('Formulaires');
  const forms = useAuthQuery(api.features.forms.queries.listForms, {});
  const deleteForm = useAuthMutation(api.features.forms.mutations.deleteForm);
  const updateForm = useAuthMutation(api.features.forms.mutations.updateForm);

  const [editorOpen, setEditorOpen] = useState(false);
  const [toEditId, setToEditId] = useState<Id<'forms'> | null>(null);
  const [embedId, setEmbedId] = useState<Id<'forms'> | null>(null);
  const [toDelete, setToDelete] = useState<{ _id: Id<'forms'>; name: string } | null>(null);

  const toEdit = useAuthQuery(
    api.features.forms.queries.getForm,
    toEditId ? { formId: toEditId } : 'skip',
  );

  const toggleActive = async (formId: Id<'forms'>, active: boolean) => {
    try {
      await updateForm({ formId, active });
    } catch {
      toast.error('Échec de la mise à jour.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Formulaires"
        subtitle="Formulaires de capture à intégrer sur vos pages web — chaque envoi crée ou met à jour un lead avec son consentement"
        actions={
          <Button
            onClick={() => {
              setToEditId(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nouveau formulaire
          </Button>
        }
      />
      <div className="mt-6">
        {forms === undefined ? (
          <Spinner size="sm" />
        ) : forms.length === 0 ? (
          <p className="text-sm text-soft">
            Aucun formulaire. Créez-en un pour capturer des leads depuis vos pages web.
          </p>
        ) : (
          <Card className="divide-y divide-border p-0">
            {forms.map((form) => (
              <div key={form._id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{form.name}</p>
                  <p className="text-xs text-faint">{form.fieldCount} champ(s)</p>
                </div>
                <StatusBadge tone={form.active ? 'green' : 'gray'} withDot>
                  {form.active ? 'Actif' : 'Inactif'}
                </StatusBadge>
                <Switch
                  checked={form.active}
                  onCheckedChange={(checked) => toggleActive(form._id, checked)}
                  aria-label={`Activer ${form.name}`}
                />
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label={`Code d’intégration de ${form.name}`}
                  onClick={() => setEmbedId(form._id)}
                >
                  <Code2 className="size-4" />
                </IconButton>
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label={`Modifier ${form.name}`}
                  onClick={() => {
                    setToEditId(form._id);
                    setEditorOpen(true);
                  }}
                >
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton
                  variant="secondary"
                  size="sm"
                  aria-label={`Supprimer ${form.name}`}
                  onClick={() => setToDelete(form)}
                >
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
          </Card>
        )}
      </div>

      {editorOpen && (toEditId === null || toEdit !== undefined) && (
        <FormEditorDialog
          form={toEditId && toEdit ? toEdit : null}
          onClose={() => {
            setEditorOpen(false);
            setToEditId(null);
          }}
        />
      )}
      {embedId && <EmbedDialog formId={embedId} onClose={() => setEmbedId(null)} />}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Supprimer « ${toDelete?.name ?? ''} » ?`}
        description="Le formulaire ne sera plus accessible publiquement. Les soumissions passées restent dans la chronologie des leads."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteForm({ formId: toDelete._id });
            toast.success('Formulaire supprimé.');
          } catch {
            toast.error('Échec de la suppression.');
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
