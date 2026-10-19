import type { FunctionReturnType } from 'convex/server';
import type { api } from '@crm/lib/backend';

export type PluginRow = FunctionReturnType<typeof api.features.plugins.queries.listPlugins>[number];
