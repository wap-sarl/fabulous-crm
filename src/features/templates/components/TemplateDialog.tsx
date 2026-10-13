import { useState } from 'react';
import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { TemplateScope } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@crm/design-system';
import { EmailBodyEditor } from '../../campaigns/components/EmailBodyEditor';
import { buildPlaceholders } from '../../campaigns/lib/placeholders';
import { usePropertyDefinitions } from '../../properties/hooks/usePropertyDefinitions';
import { TEMPLATE_SCOPE_HELP, TEMPLATE_SCOPE_LABEL } from '../lib/constants';
import { templateErrorMessage } from '../lib/errors';
import { fieldErrorsOf, type TemplateForm, templateFormSchema } from '../lib/form';
import type { EmailTemplateRow } from '../types';

const FIELD_ERROR: Partial<Record<keyof TemplateForm, string>> = {
  name: 'Le nom est requis (80 caractères au plus).',
  subject: 'L’objet est requis (200 caractères au plus).',
  htmlBody: 'Le contenu est requis.',
  category: 'La catégorie dépasse 40 caractères.',
};

const SCOPES: TemplateScope[] = ['private', 'team', 'organization'];

/** Create or edit a template, or save an e-mail written elsewhere as one (`initial` without a `template`). */
export function TemplateDialog({
  template,
  initial,
  categories,
  onClose,
  onSaved,
}: {
  template: EmailTemplateRow | null;
  /** The subject and body to start from, when saving an e-mail as a template. */
  initial?: Pick<TemplateForm, 'subject' | 'htmlBody'>;
  categories: string[];
  onClose: () => void;
  onSaved?: (templateId: EmailTemplateRow['_id']) => void;
}) {
  const createTemplate = useAuthMutation(api.features.emailTemplates.mutations.createEmailTemplate);
  const updateTemplate = useAuthMutation(api.features.emailTemplates.mutations.updateEmailTemplate);
  const definitions = usePropertyDefinitions('lead');
  const placeholders = buildPlaceholders(definitions, []);
  const [form, setForm] = useState<TemplateForm>({
    name: template?.name ?? '',
    subject: template?.subject ?? initial?.subject ?? '',
    htmlBody: template?.htmlBody ?? initial?.htmlBody ?? '',
    category: template?.category ?? '',
    scope: template?.scope ?? 'private',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof TemplateForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TemplateForm>(key: K, value: TemplateForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    const parsed = templateFormSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error, FIELD_ERROR));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const data = { ...parsed.data, category: parsed.data.category || undefined };
      let templateId = template?._id;
      if (template) {
        await updateTemplate({ templateId: template._id, ...data });
        toast.success('Modèle mis à jour.');
      } else {
        templateId = await createTemplate(data);
        toast.success('Modèle enregistré.');
      }
      if (templateId) onSaved?.(templateId);
      onClose();
    } catch (error) {
      toast.error(templateErrorMessage(error, 'Échec de l’enregistrement.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {template
              ? 'Modifier le modèle'
              : initial
                ? 'Enregistrer comme modèle'
                : 'Nouveau modèle'}
          </DialogTitle>
        </DialogHeader>
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="template-name">Nom</Label>
              <Input
                id="template-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Relance après démonstration"
                aria-invalid={!!errors.name}
              />
              {errors.name && <HelperText className="text-destructive">{errors.name}</HelperText>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-category">Catégorie</Label>
              <Input
                id="template-category"
                list="template-categories"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                placeholder="Suivi"
                className="w-40"
                aria-invalid={!!errors.category}
              />
              <datalist id="template-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Visibilité</Label>
              <Select value={form.scope} onValueChange={(v) => set('scope', v as TemplateScope)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {TEMPLATE_SCOPE_LABEL[scope]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <HelperText>{TEMPLATE_SCOPE_HELP[form.scope]}</HelperText>
          <div className="space-y-1.5">
            <Label htmlFor="template-subject">Objet</Label>
            <Input
              id="template-subject"
              value={form.subject}
              onChange={(e) => set('subject', e.target.value)}
              placeholder="Bonjour {{ params.firstName }}"
              aria-invalid={!!errors.subject}
            />
            {errors.subject && (
              <HelperText className="text-destructive">{errors.subject}</HelperText>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Corps de l’e-mail</Label>
            <EmailBodyEditor
              value={form.htmlBody}
              onChange={(html) => set('htmlBody', html)}
              placeholders={placeholders}
            />
            {errors.htmlBody && (
              <HelperText className="text-destructive">{errors.htmlBody}</HelperText>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save}>
            {template ? 'Enregistrer' : 'Créer le modèle'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
