import type { Doc } from '../_generated/dataModel';

export function normalizeSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The searchText value a lead document should carry. */
export function leadSearchText(
  lead: Pick<Doc<'leads'>, 'firstName' | 'lastName' | 'email' | 'phone'>,
): string {
  const parts = [lead.firstName, lead.lastName, lead.email ?? '', lead.phone ?? ''];
  // Also index the phone squashed to digits, so a full number pasted with or
  // without separators matches ("+33 6 12 34" and "0612…" both tokenize).
  const digits = (lead.phone ?? '').replace(/\D/g, '');
  if (digits) parts.push(digits);
  return normalizeSearchText(parts.join(' '));
}
