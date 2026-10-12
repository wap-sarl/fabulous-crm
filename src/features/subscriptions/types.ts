import type { FunctionReturnType } from 'convex/server';
import type { api } from '@crm/lib/backend';

export type SubscriptionTypeRow = FunctionReturnType<
  typeof api.features.subscriptions.queries.listSubscriptionTypes
>[number];
