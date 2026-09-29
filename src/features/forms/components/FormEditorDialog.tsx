import { useMemo, useState } from 'react';
import { useAuthMutation } from '@crm/widgets';
import { api, FORM_STANDARD_FIELDS, formFieldKey } from '@crm/lib/backend';
import type { Form, FormFieldInput as FormField, FormStandardField, Id } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SortableList,
  Switch,
  Textarea,
  toast,
} from '@crm/design-system';
import { Trash2 } from 'lucide-react';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import type { EditorDraft } from '../types';
import { FormPreview } from './FormPreview';

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

export function FormEditorDialog({
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
