import { z } from 'zod';
import {
  snippetNameSchema,
  snippetShortcutSchema,
  snippetTextSchema,
  templateBodySchema,
  templateCategorySchema,
  templateNameSchema,
  templateSubjectSchema,
} from '@crm/lib/backend';

export const templateFormSchema = z.object({
  name: templateNameSchema,
  subject: templateSubjectSchema,
  htmlBody: templateBodySchema,
  category: templateCategorySchema,
  scope: z.enum(['private', 'team', 'organization']),
});
export type TemplateForm = z.infer<typeof templateFormSchema>;

export const snippetFormSchema = z.object({
  name: snippetNameSchema,
  shortcut: snippetShortcutSchema,
  text: snippetTextSchema,
});
export type SnippetForm = z.infer<typeof snippetFormSchema>;

/** The field at fault of a failed parse, with the message the dialog shows. */
export function fieldErrorsOf<T extends Record<string, unknown>>(
  error: z.ZodError<T>,
  messages: Partial<Record<keyof T, string>>,
): Partial<Record<keyof T, string>> {
  const out: Partial<Record<keyof T, string>> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0]) as keyof T;
    out[key] = messages[key] ?? issue.message;
  }
  return out;
}
