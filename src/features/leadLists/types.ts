import type { Id, LeadAdvancedFilter } from '@crm/lib/backend';

export type LeadListRow = {
  _id: Id<'leadLists'>;
  name: string;
  kind: 'static' | 'dynamic';
  criteria: LeadAdvancedFilter | null;
  lastRecalcAt: number | null;
  recalcProcessed: number | null;
  memberCount: number;
  createdByName: string | null;
  createdAt: number;
};
