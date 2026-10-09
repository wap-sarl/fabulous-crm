import type { Id, LandingSection } from '@crm/lib/backend';
import {
  HelperText,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@crm/design-system';
import { EmailBodyEditor } from '../../campaigns/components/EmailBodyEditor';

export interface FormOption {
  _id: Id<'forms'>;
  name: string;
}

interface SectionFieldsProps {
  section: LandingSection;
  onChange: (next: LandingSection) => void;
  forms: FormOption[];
}

const TO_FORM = '#form';

/** The address a button leads to: the page's form, or a URL typed in. */
function HrefField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const toForm = value === TO_FORM;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Le bouton mène</Label>
      <Select
        value={toForm ? TO_FORM : 'url'}
        onValueChange={(v) => onChange(v === TO_FORM ? TO_FORM : '')}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TO_FORM}>au formulaire de la page</SelectItem>
          <SelectItem value="url">à une adresse</SelectItem>
        </SelectContent>
      </Select>
      {!toForm && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://…"
          aria-label="Adresse du bouton"
        />
      )}
    </div>
  );
}

/** The fields of one block, by its type. */
export function SectionFields({ section, onChange, forms }: SectionFieldsProps) {
  const field = (label: string, key: string, value: string | undefined, placeholder?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`${section.id}-${key}`}>{label}</Label>
      <Input
        id={`${section.id}-${key}`}
        value={value ?? ''}
        onChange={(e) =>
          onChange({ ...section, [key]: e.target.value || undefined } as LandingSection)
        }
        placeholder={placeholder}
      />
    </div>
  );

  switch (section.type) {
    case 'hero':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field('Titre', 'heading', section.heading)}</div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor={`${section.id}-text`}>Texte</Label>
            <Textarea
              id={`${section.id}-text`}
              value={section.text ?? ''}
              onChange={(e) => onChange({ ...section, text: e.target.value || undefined })}
              rows={2}
            />
          </div>
          {field('Bouton', 'ctaLabel', section.ctaLabel, 'Demander une démo')}
          <HrefField
            id={`${section.id}-href`}
            value={section.ctaHref ?? ''}
            onChange={(ctaHref) => onChange({ ...section, ctaHref: ctaHref || undefined })}
          />
          <div className="sm:col-span-2">
            {field('Image (adresse)', 'imageUrl', section.imageUrl, 'https://…')}
          </div>
        </div>
      );
    case 'text':
      return (
        <EmailBodyEditor
          value={section.html}
          onChange={(html) => onChange({ ...section, html })}
          placeholders={[]}
        />
      );
    case 'image':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {field('Adresse de l’image', 'url', section.url, 'https://…')}
          </div>
          {field('Texte alternatif', 'alt', section.alt)}
          {field('Légende', 'caption', section.caption)}
        </div>
      );
    case 'cta':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">{field('Titre', 'heading', section.heading)}</div>
          <div className="sm:col-span-2">{field('Texte', 'text', section.text)}</div>
          {field('Bouton', 'label', section.label)}
          <HrefField
            id={`${section.id}-href`}
            value={section.href}
            onChange={(href) => onChange({ ...section, href })}
          />
        </div>
      );
    case 'form':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${section.id}-form`}>Formulaire</Label>
            <Select
              value={section.formId}
              onValueChange={(formId) => onChange({ ...section, formId: formId as Id<'forms'> })}
            >
              <SelectTrigger id={`${section.id}-form`} className="w-full">
                <SelectValue placeholder="Choisir…" />
              </SelectTrigger>
              <SelectContent>
                {forms.map((f) => (
                  <SelectItem key={f._id} value={f._id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {forms.length === 0 && (
              <HelperText>Aucun formulaire : créez-en un dans Paramètres → Formulaires.</HelperText>
            )}
          </div>
          {field('Titre', 'heading', section.heading, 'Vos coordonnées')}
        </div>
      );
  }
}
