import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

const NONE: never[] = [];

/** Every subscription type in order; the same empty array while loading. */
export function useSubscriptionTypes(enabled = true) {
  return (
    useAuthQuery(api.features.subscriptions.queries.listSubscriptionTypes, enabled ? {} : 'skip') ??
    NONE
  );
}
