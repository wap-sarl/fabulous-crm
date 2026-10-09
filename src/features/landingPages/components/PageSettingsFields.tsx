import { HelperText, Input, Label, Textarea } from '@crm/design-system';
import { MAX_SEO_DESCRIPTION, MAX_SEO_TITLE } from '@crm/lib/backend';
import type { PageDraft } from '../types';

interface PageSettingsFieldsProps {
  draft: PageDraft;
  onChange: (next: PageDraft) => void;
}

/** The page's name, its address and what search engines and social networks show of it. */
export function PageSettingsFields({ draft, onChange }: PageSettingsFieldsProps) {
  const seo = (patch: Partial<PageDraft['seo']>) =>
    onChange({ ...draft, seo: { ...draft.seo, ...patch } });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="page-name">Nom</Label>
        <Input
          id="page-name"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="page-slug">Adresse</Label>
        <Input
          id="page-slug"
          value={draft.slug}
          onChange={(e) => onChange({ ...draft, slug: e.target.value })}
        />
        <HelperText>/p/{draft.slug || '…'}</HelperText>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="page-title">Titre affiché par les moteurs de recherche</Label>
        <Input
          id="page-title"
          value={draft.seo.title}
          maxLength={MAX_SEO_TITLE}
          onChange={(e) => seo({ title: e.target.value })}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="page-description">Description</Label>
        <Textarea
          id="page-description"
          value={draft.seo.description ?? ''}
          maxLength={MAX_SEO_DESCRIPTION}
          rows={2}
          onChange={(e) => seo({ description: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="page-image">Image de partage (adresse)</Label>
        <Input
          id="page-image"
          value={draft.seo.imageUrl ?? ''}
          placeholder="https://…"
          onChange={(e) => seo({ imageUrl: e.target.value || undefined })}
        />
      </div>
    </div>
  );
}
