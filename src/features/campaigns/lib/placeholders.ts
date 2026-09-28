import { customPropertyParamKey } from '@crm/lib/backend';
import type { CampaignTrackedLink } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../../properties/types';

/** `kind` drives the filtering (a tracked-link URL is kept out of the email subject) and the styling of the chip. */
export interface PlaceholderItem {
  key: string;
  label: string;
  token: string;
  kind: 'fixed' | 'custom' | 'link';
}

// Built-in lead fields injected for every recipient (see createCampaign).
const FIXED_PLACEHOLDERS: PlaceholderItem[] = [
  { key: 'firstName', label: 'Prénom', token: '{{ params.firstName }}', kind: 'fixed' },
  { key: 'lastName', label: 'Nom', token: '{{ params.lastName }}', kind: 'fixed' },
  { key: 'email', label: 'E-mail', token: '{{ params.email }}', kind: 'fixed' },
  { key: 'phone', label: 'Téléphone', token: '{{ params.phone }}', kind: 'fixed' },
  { key: 'status', label: 'Statut', token: '{{ params.status }}', kind: 'fixed' },
  { key: 'comment', label: 'Commentaire', token: '{{ params.comment }}', kind: 'fixed' },
  { key: 'address', label: 'Adresse', token: '{{ params.address }}', kind: 'fixed' },
  {
    key: 'consentUrl',
    label: 'Lien de consentement',
    token: '{{ params.consentUrl }}',
    kind: 'fixed',
  },
];

/** Must mirror the params built per recipient in createCampaign. */
export function buildPlaceholders(
  definitions: PropertyDefinitionRow[],
  trackedLinks: CampaignTrackedLink[],
): PlaceholderItem[] {
  return [
    ...FIXED_PLACEHOLDERS,
    ...definitions.map((def): PlaceholderItem => {
      const key = customPropertyParamKey(def._id);
      return { key, label: def.label, token: `{{ params.${key} }}`, kind: 'custom' };
    }),
    ...trackedLinks.map(
      (link): PlaceholderItem => ({
        key: link.key,
        label: link.label,
        token: `{{ params.${link.key} }}`,
        kind: 'link',
      }),
    ),
  ];
}

/** The caret is restored on the next frame, once React has rendered the new value of the controlled field. */
export function insertAtCaret(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  currentValue: string,
  text: string,
  onChange: (next: string) => void,
) {
  const start = el?.selectionStart ?? currentValue.length;
  const end = el?.selectionEnd ?? currentValue.length;
  onChange(currentValue.slice(0, start) + text + currentValue.slice(end));
  if (el) {
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + text.length;
      el.setSelectionRange(caret, caret);
    });
  }
}
