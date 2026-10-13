import type { FunctionReturnType } from 'convex/server';
import type { api } from '@crm/lib/backend';

export type EmailTemplateRow = FunctionReturnType<
  typeof api.features.emailTemplates.queries.listEmailTemplates
>[number];

export type SnippetRow = FunctionReturnType<
  typeof api.features.snippets.queries.listSnippets
>[number];
