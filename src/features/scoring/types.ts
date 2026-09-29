import type { api } from '@crm/lib/backend';
import type { FunctionReturnType } from 'convex/server';

/** A rule as the list of rules gives it. */
export type ScoringRuleRow = FunctionReturnType<
  typeof api.features.scoring.queries.listScoringRules
>[number];
