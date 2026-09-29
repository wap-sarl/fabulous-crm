import type { Id, LeadAdvancedFilter } from '@crm/lib/backend';

export type ScoringRuleRow = {
  _id: Id<'scoringRules'>;
  name: string;
  description: string | undefined;
  criteria: LeadAdvancedFilter;
  points: number;
  active: boolean;
  decayHalfLifeDays: number | undefined;
};
