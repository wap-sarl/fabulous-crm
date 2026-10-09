import { useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, follows, landingSlugSchema, slugOf } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
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
import { pageErrorMessage } from '../lib/errors';
import { LANDING_TEMPLATES } from '../lib/templates';

const NO_FORM = '__none__';

interface NewLandingPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (pageId: Id<'landingPages'>) => void;
}

/** A name, an address, a template and the form it embeds: the page is created as a draft and opened. */
export function NewLandingPageDialog({ open, onOpenChange, onCreated }: NewLandingPageDialogProps) {
  const createPage = useAuthMutation(api.features.landingPages.mutations.createLandingPage);
  const forms = useAuthQuery(api.features.forms.queries.listFormOptions, open ? {} : 'skip') ?? [];
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [template, setTemplate] = useState(LANDING_TEMPLATES[0].key);
  const [formId, setFormId] = useState<string>(NO_FORM);
  const [submitting, setSubmitting] = useState(false);

  const changeName = (next: string) => {
    setName(next);
    if (!slugEdited) setSlug(slugOf(next));
  };

  const submit = async () => {
    const chosen = LANDING_TEMPLATES.find((t) => t.key === template) ?? LANDING_TEMPLATES[0];
    setSubmitting(true);
    try {
      const pageId = await createPage({
        name: name.trim(),
        slug: slug.trim(),
        seo: { title: name.trim() },
        sections: chosen.sections(formId === NO_FORM ? undefined : (formId as Id<'forms'>)),
      });
      onOpenChange(false);
      setName('');
      setSlug('');
      setSlugEdited(false);
      onCreated(pageId);
    } catch (error) {
      toast.error(pageErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle page</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="space-y-1">
            <Label htmlFor="page-name">Nom</Label>
            <Input
              id="page-name"
              value={name}
              onChange={(e) => changeName(e.target.value)}
              placeholder="Demande de démo"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="page-slug">Adresse</Label>
            <Input
              id="page-slug"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(e.target.value);
              }}
              placeholder="demande-de-demo"
            />
            <HelperText>
              La page répondra sous /p/{slug || '…'} : minuscules, chiffres, tirets.
            </HelperText>
          </div>
          <div className="space-y-1">
            <Label htmlFor="page-template">Modèle</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger id="page-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANDING_TEMPLATES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>
              {LANDING_TEMPLATES.find((t) => t.key === template)?.description}
            </HelperText>
          </div>
          <div className="space-y-1">
            <Label htmlFor="page-form">Formulaire</Label>
            <Select value={formId} onValueChange={setFormId}>
              <SelectTrigger id="page-form" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FORM}>Aucun pour l’instant</SelectItem>
                {forms.map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>Les formulaires se créent dans Paramètres → Formulaires.</HelperText>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || !follows(landingSlugSchema, slug.trim())}
          >
            Créer la page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
