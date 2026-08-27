import { useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { PropertyEntityType } from '@crm/lib/backend';
import type { PropertyDefinitionRow } from '../types';

const EMPTY: PropertyDefinitionRow[] = [];

export function usePropertyDefinitions(entityType: PropertyEntityType): PropertyDefinitionRow[] {
  const defs = useQuery(api.features.properties.queries.listDefinitions, { entityType });
  return defs ?? EMPTY;
}
