import type { TimelineKind } from '@crm/lib/backend';
import { LEAD_FIELD_LABEL as LEAD_STANDARD_LABEL } from '../../leads/lib/leadFilters';

/** Timeline filter chips: one entry may cover several event kinds. */
export interface TimelineFilter {
  value: string;
  label: string;
  /** Empty = every kind. */
  kinds: TimelineKind[];
}

export const TIMELINE_FILTERS: TimelineFilter[] = [
  { value: 'all', label: 'Tout', kinds: [] },
  { value: 'notes', label: 'Notes', kinds: ['note'] },
  { value: 'activities', label: 'Activités', kinds: ['activity'] },
  { value: 'campaigns', label: 'Campagnes', kinds: ['campaign_send', 'campaign_event'] },
  { value: 'workflows', label: 'Workflows', kinds: ['workflow_run'] },
  { value: 'lifecycle', label: 'Statut', kinds: ['lifecycle'] },
  { value: 'deals', label: 'Transactions', kinds: ['deal'] },
  { value: 'changes', label: 'Modifications', kinds: ['audit'] },
];

/** French labels of the lead fields an audit entry can list. */
export const LEAD_FIELD_LABEL: Record<string, string> = {
  ...LEAD_STANDARD_LABEL,
  address: 'Adresse',
  companyId: 'Entreprise',
  customProperties: 'Propriétés personnalisées',
  consentSource: 'Source du consentement',
};
