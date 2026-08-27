import type { DuplicateReason } from '@crm/lib/backend';
import type { StatusTone } from '@crm/design-system';

export const DUPLICATE_REASON_LABEL: Record<DuplicateReason, string> = {
  email: 'Même e-mail',
  phone: 'Même téléphone',
  name_postal: 'Même nom et code postal',
  same_name: 'Même nom',
  similar_name: 'Nom proche',
};

export const DUPLICATE_REASON_TONE: Record<DuplicateReason, StatusTone> = {
  email: 'red',
  phone: 'red',
  name_postal: 'amber',
  same_name: 'gray',
  similar_name: 'gray',
};
