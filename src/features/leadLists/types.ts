import type { api } from '@crm/lib/backend';
import type { FunctionReturnType } from 'convex/server';

/** A list as the list of lists gives it, its member count included. */
export type LeadListRow = FunctionReturnType<
  typeof api.features.leadLists.queries.listLeadLists
>[number];
