import { useState } from 'react';
import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
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
  Textarea,
  toast,
} from '@crm/design-system';
import { templateErrorMessage } from '../lib/errors';
import { fieldErrorsOf, type SnippetForm, snippetFormSchema } from '../lib/form';
import type { SnippetRow } from '../types';

const FIELD_ERROR: Partial<Record<keyof SnippetForm, string>> = {
  name: 'Le nom est requis (80 caractères au plus).',
  shortcut: 'Le raccourci commence par / : minuscules, chiffres et tirets (30 au plus).',
  text: 'Le texte est requis (2 000 caractères au plus).',
};

export function SnippetDialog({
  snippet,
  onClose,
}: {
  snippet: SnippetRow | null;
  onClose: () => void;
}) {
  const createSnippet = useAuthMutation(api.features.snippets.mutations.createSnippet);
  const updateSnippet = useAuthMutation(api.features.snippets.mutations.updateSnippet);
  const [form, setForm] = useState<SnippetForm>({
    name: snippet?.name ?? '',
    shortcut: snippet?.shortcut ?? '/',
    text: snippet?.text ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof SnippetForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SnippetForm>(key: K, value: SnippetForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    const parsed = snippetFormSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrorsOf(parsed.error, FIELD_ERROR));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      if (snippet) {
        await updateSnippet({ snippetId: snippet._id, ...parsed.data });
        toast.success('Bloc mis à jour.');
      } else {
        await createSnippet(parsed.data);
        toast.success('Bloc créé.');
      }
      onClose();
    } catch (error) {
      toast.error(templateErrorMessage(error, 'Échec de l’enregistrement.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{snippet ? 'Modifier le bloc' : 'Nouveau bloc de texte'}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="snippet-name">Nom</Label>
              <Input
                id="snippet-name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Signature"
                aria-invalid={!!errors.name}
              />
              {errors.name && <HelperText className="text-destructive">{errors.name}</HelperText>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="snippet-shortcut">Raccourci</Label>
              <Input
                id="snippet-shortcut"
                value={form.shortcut}
                onChange={(e) => set('shortcut', e.target.value)}
                placeholder="/signature"
                className="font-mono"
                aria-invalid={!!errors.shortcut}
              />
              <HelperText className={errors.shortcut ? 'text-destructive' : undefined}>
                {errors.shortcut ?? 'Tapé dans l’éditeur, il insère le texte.'}
              </HelperText>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="snippet-text">Texte</Label>
            <Textarea
              id="snippet-text"
              value={form.text}
              onChange={(e) => set('text', e.target.value)}
              rows={4}
              placeholder={'Cordialement,\nL’équipe'}
              aria-invalid={!!errors.text}
            />
            <HelperText className={errors.text ? 'text-destructive' : undefined}>
              {errors.text ??
                'Chaque ligne devient un paragraphe ; les champs {{ params.x }} sont permis.'}
            </HelperText>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} onClick={save}>
            {snippet ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
