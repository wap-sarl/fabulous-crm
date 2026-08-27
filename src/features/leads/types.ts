import type { Doc } from '@crm/lib/backend';

export type LeadRow = Doc<'leads'> & { companyName?: string | null };
