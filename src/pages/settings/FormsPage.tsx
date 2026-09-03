import { useMemo, useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, FORM_STANDARD_FIELDS, formFieldKey } from '@crm/lib/backend';
import type { Form, FormField, FormStandardField, Id } from '@crm/lib/backend';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SortableList,
  Spinner,
  StatusBadge,
  Switch,
  Textarea,
  toast,
} from '@crm/design-system';
import { Code2, Pencil, Plus, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { usePropertyDefinitions } from '../../features/properties/hooks/usePropertyDefinitions';
import type { PropertyDefinitionRow } from '../../features/properties/types';

const STANDARD_FIELD_LABEL: Record<FormStandardField, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  email: 'E-mail',
  phone: 'Téléphone',
  company: 'Société',
  comment: 'Message',
};

const DEFAULT_CONSENT_TEXT =
  'J’accepte de recevoir des communications par e-mail. Je peux me désinscrire à tout moment.';

const SAVE_ERRORS: Record<string, string> = {
  form_name_required: 'Le nom du formulaire est requis.',
  form_fields_required: 'Ajoutez au moins un champ.',
  form_too_many_fields: 'Trop de champs.',
  form_field_label_required: 'Chaque champ doit avoir un libellé.',
  form_duplicate_field: 'Une propriété ne peut apparaître qu’une fois.',
  form_button_text_required: 'Le texte du bouton est requis.',
  form_consent_text_required: 'La phrase de consentement RGPD est requise.',
  form_invalid_redirect_url: 'L’URL de redirection doit commencer par http(s)://.',
  form_message_required: 'Le message de confirmation est requis.',
  form_unknown_property: 'Une propriété du formulaire n’existe plus.',
};

function saveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const known = Object.keys(SAVE_ERRORS).find((code) => message.includes(code));
  return known ? SAVE_ERRORS[known] : 'Échec de l’enregistrement du formulaire.';
}

/** Deployment origin serving the public routes (…convex.site). */
function convexSiteUrl(): string {
  const env = (typeof window !== 'undefined' && window.__ENV__) || {};
  const explicit = env.VITE_CONVEX_SITE_URL ?? import.meta.env.VITE_CONVEX_SITE_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  const convexUrl = String(env.VITE_CONVEX_URL ?? import.meta.env.VITE_CONVEX_URL ?? '');
  return convexUrl.replace(/\.convex\.cloud\/?$/, '.convex.site').replace(/\/+$/, '');
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copié.');
    } catch {
      toast.error('Impossible de copier.');
    }
  };
  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold text-soft">{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md bg-[#F2F3F5] px-2 py-1.5 font-mono text-xs text-body">
          {value}
        </code>
        <Button variant="outline" size="sm" onClick={copy}>
          Copier
        </Button>
      </div>
    </div>
  );
}

/** Script tag + iframe URL of a saved form. */
function EmbedDialog({ formId, onClose }: { formId: Id<'forms'>; onClose: () => void }) {
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
            par son attribut <code>data-target</code>). Styles isolés de la page hôte.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EditorDraft {
  name: string;
  fields: FormField[];
  buttonText: string;
  consentText: string;
  afterKind: 'message' | 'redirect';
  afterMessage: string;
  afterUrl: string;
  active: boolean;
}

function draftOf(form: Form & { _id: Id<'forms'> }): EditorDraft {
  return {
    name: form.name,
    fields: form.fields,
    buttonText: form.buttonText,
    consentText: form.consentText,
    afterKind: form.afterSubmit.kind,
    afterMessage: form.afterSubmit.kind === 'message' ? form.afterSubmit.message : 'Merci !',
    afterUrl: form.afterSubmit.kind === 'redirect' ? form.afterSubmit.url : '',
    active: form.active,
  };
}

const NEW_DRAFT: EditorDraft = {
  name: '',
  fields: [
    { target: { kind: 'standard', field: 'firstName' }, label: 'Prénom', required: true },
    { target: { kind: 'standard', field: 'lastName' }, label: 'Nom', required: false },
    { target: { kind: 'standard', field: 'email' }, label: 'E-mail', required: true },
  ],
  buttonText: 'Envoyer',
  consentText: DEFAULT_CONSENT_TEXT,
  afterKind: 'message',
  afterMessage: 'Merci ! Nous revenons vers vous rapidement.',
  afterUrl: '',
  active: true,
};

/** Static rendering of the form as visitors will see it. */
function FormPreview({
  draft,
  defsById,
}: {
  draft: EditorDraft;
  defsById: Map<string, PropertyDefinitionRow>;
}) {
  const input = (field: FormField) => {
    const type =
      field.target.kind === 'custom'
        ? (defsById.get(field.target.propertyDefId)?.type ?? 'text')
        : null;
    const options =
      field.target.kind === 'custom'
        ? (defsById.get(field.target.propertyDefId)?.options ?? [])
        : [];
    if (field.target.kind === 'standard' && field.target.field === 'comment') {
      return <Textarea disabled rows={3} className="bg-white" />;
    }
    if (type === 'select') {
      return (
        <select
          disabled
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
        >
          <option />
          {options.map((o) => (
            <option key={o.value}>{o.label}</option>
          ))}
        </select>
      );
    }
    if (type === 'radio' || type === 'checkbox') {
      return (
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm text-body">
              <input type={type === 'radio' ? 'radio' : 'checkbox'} disabled />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    if (type === 'boolean') {
      return (
        <label className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" disabled />
          {field.label}
        </label>
      );
    }
    return (
      <Input
        disabled
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
        className="bg-white"
      />
    );
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-[#FAFAFB] p-4">
      {draft.fields.map((field) => (
        <div key={formFieldKey(field.target)} className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-ink">
            {field.label || '(sans libellé)'}
            {field.required ? ' *' : ''}
          </span>
          {input(field)}
        </div>
      ))}
      <label className="flex items-start gap-2 text-xs text-soft">
        <input type="checkbox" disabled className="mt-0.5" />
        {draft.consentText}
      </label>
      <Button disabled className="self-start">
        {draft.buttonText || 'Envoyer'}
      </Button>
    </div>
  );
}

function FormEditorDialog({
  form,
  onClose,
}: {
  form: (Form & { _id: Id<'forms'> }) | null;
  onClose: () => void;
}) {
  const createForm = useAuthMutation(api.features.forms.mutations.createForm);
  const updateForm = useAuthMutation(api.features.forms.mutations.updateForm);
  const definitions = usePropertyDefinitions('lead');
  const defsById = useMemo(
    () => new Map(definitions.map((d) => [d._id as string, d])),
    [definitions],
  );

  const [draft, setDraft] = useState<EditorDraft>(() => (form ? draftOf(form) : NEW_DRAFT));
  const [busy, setBusy] = useState(false);

  const usedKeys = useMemo(
    () => new Set(draft.fields.map((f) => formFieldKey(f.target))),
    [draft.fields],
  );

  const set = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const addField = (key: string) => {
    const field: FormField = key.startsWith('cp:')
      ? {
          target: { kind: 'custom', propertyDefId: key.slice(3) as Id<'propertyDefinitions'> },
          label: defsById.get(key.slice(3))?.label ?? '',
          required: false,
        }
      : {
          target: { kind: 'standard', field: key.slice(4) as FormStandardField },
          label: STANDARD_FIELD_LABEL[key.slice(4) as FormStandardField],
          required: false,
        };
    set('fields', [...draft.fields, field]);
  };

  const patchField = (index: number, patch: Partial<FormField>) =>
    set(
      'fields',
      draft.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: draft.name,
        fields: draft.fields,
        buttonText: draft.buttonText,
        consentText: draft.consentText,
        afterSubmit:
          draft.afterKind === 'message'
            ? ({ kind: 'message', message: draft.afterMessage } as const)
            : ({ kind: 'redirect', url: draft.afterUrl } as const),
        active: draft.active,
      };
      if (form) await updateForm({ formId: form._id, ...payload });
      else await createForm(payload);
      toast.success('Formulaire enregistré.');
      onClose();
    } catch (e) {
      toast.error(saveErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{form ? 'Modifier le formulaire' : 'Nouveau formulaire'}</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] grid-cols-1 gap-6 overflow-y-auto pr-1 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
              <Label>Nom</Label>
              <Input
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Formulaire de contact"
                data-testid="form-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Champs</Label>
              <SortableList
                items={draft.fields.map((f, i) => ({ ...f, __id: formFieldKey(f.target), __i: i }))}
                getId={(f) => f.__id}
                onReorder={(ordered) =>
                  set(
                    'fields',
                    ordered.map(({ __id, __i, ...f }) => f as FormField),
                  )
                }
                itemClassName="flex items-center gap-2"
                renderItem={(field, index, handle) => (
                  <>
                    {handle}
                    <Input
                      value={field.label}
                      onChange={(e) => patchField(index, { label: e.target.value })}
                      aria-label={`Libellé du champ ${index + 1}`}
                      className="flex-1"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-soft">
                      <Switch
                        checked={field.required}
                        onCheckedChange={(checked) => patchField(index, { required: checked })}
                        aria-label={`Champ ${index + 1} requis`}
                      />
                      Requis
                    </label>
                    <IconButton
                      variant="secondary"
                      size="sm"
                      aria-label={`Retirer le champ ${field.label}`}
                      onClick={() =>
                        set(
                          'fields',
                          draft.fields.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </>
                )}
              />
              <Select value="" onValueChange={addField}>
                <SelectTrigger className="w-full" data-testid="add-form-field">
                  <SelectValue placeholder="Ajouter un champ…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Propriétés standard</SelectLabel>
                    {FORM_STANDARD_FIELDS.filter((f) => !usedKeys.has(`std:${f}`)).map((f) => (
                      <SelectItem key={f} value={`std:${f}`}>
                        {STANDARD_FIELD_LABEL[f]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {definitions.filter((d) => !d.computed && !usedKeys.has(`cp:${d._id}`)).length >
                    0 && (
                    <SelectGroup>
                      <SelectLabel>Propriétés personnalisées</SelectLabel>
                      {definitions
                        .filter((d) => !d.computed && !usedKeys.has(`cp:${d._id}`))
                        .map((d) => (
                          <SelectItem key={d._id} value={`cp:${d._id}`}>
                            {d.label}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Texte du bouton</Label>
              <Input value={draft.buttonText} onChange={(e) => set('buttonText', e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Phrase de consentement (RGPD)</Label>
              <Textarea
                value={draft.consentText}
                onChange={(e) => set('consentText', e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Après l’envoi</Label>
              <SegmentedControl
                aria-label="Action après envoi"
                items={[
                  { value: 'message', label: 'Afficher un message' },
                  { value: 'redirect', label: 'Rediriger' },
                ]}
                value={draft.afterKind}
                onChange={(kind) => set('afterKind', kind)}
              />
              {draft.afterKind === 'message' ? (
                <Input
                  value={draft.afterMessage}
                  onChange={(e) => set('afterMessage', e.target.value)}
                  placeholder="Merci !"
                  aria-label="Message de confirmation"
                />
              ) : (
                <Input
                  value={draft.afterUrl}
                  onChange={(e) => set('afterUrl', e.target.value)}
                  placeholder="https://exemple.fr/merci"
                  aria-label="URL de redirection"
                />
              )}
            </div>

            <label className="flex items-center gap-3 text-sm">
              <Switch
                checked={draft.active}
                onCheckedChange={(checked) => set('active', checked)}
                aria-label="Formulaire actif"
              />
              <span className="font-medium text-ink">Actif (accessible publiquement)</span>
            </label>
          </div>

          <div className="space-y-1.5">
            <Label>Aperçu</Label>
            <FormPreview draft={draft} defsById={defsById} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={save} loading={busy} data-testid="save-form">
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
