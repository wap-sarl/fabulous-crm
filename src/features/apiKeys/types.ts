import type { api } from '@crm/lib/backend';
import type { FunctionReturnType } from 'convex/server';

/** A key as the list gives it. */
export type ApiKeyRow = FunctionReturnType<typeof api.features.api.queries.listApiKeys>[number];
