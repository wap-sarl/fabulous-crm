import type { Doc } from '../../_generated/dataModel';
import { slugOf } from '../../_lib/text';

export function normalizeSearchText(raw: string): string {
  return slugOf(raw, ' ');
}

/** The searchText value a lead document should carry. */
export function leadSearchText(
  lead: Pick<Doc<'leads'>, 'firstName' | 'lastName' | 'email' | 'phone'>,
  companyName?: string,
): string {
  const parts = [
    lead.firstName,
    lead.lastName,
    lead.email ?? '',
    lead.phone ?? '',
    companyName ?? '',
  ];
  // The phone is also indexed squashed to digits, so a full number pasted with or without separators matches.
  const digits = (lead.phone ?? '').replace(/\D/g, '');
  if (digits) parts.push(digits);
  return normalizeSearchText(parts.join(' '));
}
