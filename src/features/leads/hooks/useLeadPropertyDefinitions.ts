import { useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { LeadPropertyDefinitionRow } from '../types';

const EMPTY: LeadPropertyDefinitionRow[] = [];

/**
 * Active custom property definitions, ordered. Returns [] while loading so
 * callers can render unconditionally. Consumed by the lead form, table, detail
 * page, and toolbar filters.
 */
export function useLeadPropertyDefinitions(): LeadPropertyDefinitionRow[] {
  const defs = useQuery(api.features.leadProperties.queries.listDefinitions);
  return defs ?? EMPTY;
}
