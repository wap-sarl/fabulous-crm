import type { Id } from '@crm/lib/backend';

/** The record(s) an activity is attached to. */
export interface ActivityLinks {
  leadId?: Id<'leads'>;
  companyId?: Id<'companies'>;
  dealId?: Id<'deals'>;
}
