import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

const NONE: never[] = [];

/** Every snippet, by shortcut; the same empty array while loading. */
export function useSnippets(enabled = true) {
  return useAuthQuery(api.features.snippets.queries.listSnippets, enabled ? {} : 'skip') ?? NONE;
}
