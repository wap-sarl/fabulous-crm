import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

const NONE: never[] = [];

/** The templates in reach, newest first; the same empty array while loading. */
export function useEmailTemplates(enabled = true) {
  return (
    useAuthQuery(api.features.emailTemplates.queries.listEmailTemplates, enabled ? {} : 'skip') ??
    NONE
  );
}
