import { type Infer, v } from 'convex/values';
import { z } from 'zod';
import { logsValidator, softDeleteValidator } from './shared';

/** Who may read a template: its owner, the teams the owner belongs to, or everyone. */
export const templateScopeValidator = v.union(
  v.literal('private'),
  v.literal('team'),
  v.literal('organization'),
);

/** A reusable e-mail: its HTML is what the editor produces, with the same `{{ params.x }}` placeholders as a campaign. */
export const emailTemplateValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  subject: v.string(),
  htmlBody: v.string(),
  category: v.optional(v.string()),
  ownerId: v.id('users'),
  scope: templateScopeValidator,
});

/** A text block typed by its shortcut in the editor (`/signature`); shared by the whole organisation. */
export const snippetValidator = v.object({
  ...logsValidator.fields,
  name: v.string(),
  shortcut: v.string(),
  text: v.string(),
  // Read by everyone, changed by its owner or the settings right, as a template.
  ownerId: v.id('users'),
});

export type TemplateScope = Infer<typeof templateScopeValidator>;
export type EmailTemplate = Infer<typeof emailTemplateValidator>;

export const templateNameSchema = z.string().trim().min(1).max(80);
export const templateSubjectSchema = z.string().trim().min(1).max(200);
export const templateCategorySchema = z.string().trim().max(40);
/** An editor left empty still holds its paragraph. */
export const templateBodySchema = z
  .string()
  .max(200_000)
  .refine((html) => html.trim() !== '' && html !== '<p></p>');
export const snippetNameSchema = z.string().trim().min(1).max(80);
/** Typed after a slash: lowercase letters, digits and dashes, the slash included. */
export const snippetShortcutSchema = z
  .string()
  .trim()
  .regex(/^\/[a-z0-9][a-z0-9-]{0,29}$/);
export const snippetTextSchema = z.string().trim().min(1).max(2000);

/** Shipped at setup, organisation-wide, owned by the first administrator; offered again when the library is empty. */
export const DEFAULT_EMAIL_TEMPLATES: ReadonlyArray<
  Pick<EmailTemplate, 'name' | 'subject' | 'htmlBody' | 'category'>
> = [
  {
    name: 'Bienvenue',
    category: 'Accueil',
    subject: 'Bienvenue {{ params.firstName }} !',
    htmlBody:
      '<p>Bonjour {{ params.firstName }},</p>' +
      '<p>Merci de votre intérêt. Nous sommes ravis de vous compter parmi nos contacts et nous reviendrons vers vous très vite.</p>' +
      '<p>À bientôt,</p>',
  },
  {
    name: 'Relance',
    category: 'Suivi',
    subject: 'Avez-vous eu le temps d’y réfléchir, {{ params.firstName }} ?',
    htmlBody:
      '<p>Bonjour {{ params.firstName }},</p>' +
      '<p>Je me permets de revenir vers vous au sujet de notre dernier échange. Auriez-vous un moment cette semaine pour en reparler ?</p>' +
      '<p>Bien à vous,</p>',
  },
  {
    name: 'Invitation',
    category: 'Événements',
    subject: 'Vous êtes invité(e) : notre prochain événement',
    htmlBody:
      '<p>Bonjour {{ params.firstName }},</p>' +
      '<p>Nous organisons prochainement un événement qui pourrait vous intéresser. Les places sont limitées : répondez à cet e-mail pour réserver la vôtre.</p>' +
      '<p>Au plaisir de vous y retrouver,</p>',
  },
];
