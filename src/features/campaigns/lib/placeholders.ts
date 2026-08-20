import { customPropertyParamKey } from '@crm/lib/backend';
import type { CampaignTrackedLink } from '@crm/lib/backend';
import type { LeadPropertyDefinitionRow } from '../../leads/types';

/**
 * One insertable {{ params.x }} placeholder offered in the campaign composer.
 * `kind` drives filtering (e.g. tracked-link URLs are excluded from the email
 * subject) and chip styling.
 */
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

/**
 * Full placeholder list for the composer: fixed params, one per active custom
 * property definition, and one per tracked link authored on the campaign.
 * Mirrors the params built per recipient in createCampaign.
 */
export function buildPlaceholders(
  definitions: LeadPropertyDefinitionRow[],
  trackedLinks: CampaignTrackedLink[]
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
      })
    ),
  ];
}

/**
 * Insert `text` at the caret of a controlled input/textarea (replacing any
 * selection), notify React via `onChange`, and restore focus + caret right
 * after the inserted text once React has re-rendered the new value.
 */
export function insertAtCaret(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  currentValue: string,
  text: string,
  onChange: (next: string) => void
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
