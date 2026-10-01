import { z } from 'zod';
import { DAY_MS } from '../time';
import { follows, httpUrlSchema } from './fields';
import { isActiveRule, type LeadAdvancedFilter } from './filters';
import type { WorkflowNode } from './workflows';

/* What a step must hold before its workflow can run, apart from what only the database can tell: the editor shows it under the step, the backend refuses the activation with it. */

export const WORKFLOW_STEP_LABELS: Record<WorkflowNode['type'], string> = {
  send_email: 'Envoyer un e-mail',
  send_sms: 'Envoyer un SMS',
  update_property: 'Modifier une propriété',
  set_lifecycle_stage: 'Changer le statut',
  create_deal: 'Créer une transaction',
  update_deal_stage: 'Changer le stade d’une transaction',
  create_task: 'Créer une tâche',
  add_to_list: 'Ajouter à une liste',
  remove_from_list: 'Retirer d’une liste',
  wait: 'Attendre',
  webhook: 'Webhook',
  branch: 'Condition (Si / Sinon)',
};

const WAIT_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: DAY_MS } as const;
const MAX_WAIT_MS = 90 * DAY_MS;

/** Sleep duration of a wait step. */
export function delayMs(node: { amount: number; unit: keyof typeof WAIT_UNIT_MS }): number {
  return node.amount * WAIT_UNIT_MS[node.unit];
}

const filled = (message: string) => z.string().refine((text) => text.trim() !== '', message);
const chosen = (message: string) => z.string(message).min(1, message);

const INVALID_AMOUNT = 'montant invalide.';
const INVALID_DUE = 'échéance invalide (0 à 365 jours).';
const INVALID_WAIT = 'durée invalide.';
const NO_LIST = 'choisissez une liste.';

const list = z.object({ listId: chosen(NO_LIST) });

/** The fields are checked in the order they are written: the first one at fault is the one named. */
const STEP_RULES: Record<WorkflowNode['type'], z.ZodType> = {
  send_email: z.object({
    subject: filled('l’objet est requis.'),
    // An editor left empty still holds its paragraph.
    htmlBody: z
      .string()
      .refine((html) => html.trim() !== '' && html !== '<p></p>', 'le contenu est requis.'),
  }),
  send_sms: z.object({ smsBody: filled('le message est requis.') }),
  update_property: z.object({
    value: z
      .unknown()
      .refine(
        (value) => value !== '' && !(Array.isArray(value) && value.length === 0),
        'choisissez une valeur.',
      ),
  }),
  set_lifecycle_stage: z.object({ stage: chosen('choisissez un statut.') }),
  create_deal: z.object({
    title: filled('l’intitulé est requis.'),
    amount: z.number(INVALID_AMOUNT).min(0, INVALID_AMOUNT).optional(),
  }),
  update_deal_stage: z.object({ stageKey: chosen('choisissez un stade.') }),
  create_task: z.object({
    title: filled('l’intitulé est requis.'),
    dueInDays: z.int(INVALID_DUE).min(0, INVALID_DUE).max(365, INVALID_DUE).optional(),
  }),
  add_to_list: list,
  remove_from_list: list,
  wait: z
    .object({
      amount: z.int(INVALID_WAIT).min(1, INVALID_WAIT),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
    .refine((node) => delayMs(node) <= MAX_WAIT_MS, 'durée maximale 90 jours.'),
  webhook: z.object({
    url: z
      .string()
      .refine((url) => follows(httpUrlSchema, url), 'l’URL doit commencer par http(s)://'),
  }),
  branch: z.object({
    condition: z
      .custom<LeadAdvancedFilter>()
      .refine(
        (filter) => filter.groups.some((group) => group.rules.some(isActiveRule)),
        'au moins une condition est requise.',
      ),
  }),
};

/** What is wrong with what a step holds, in the words shown to the user, or `null`. */
export function stepIssue(node: WorkflowNode): string | null {
  const result = STEP_RULES[node.type].safeParse(node);
  return result.success ? null : result.error.issues[0].message;
}

/** A step's issue as a sentence that names the step. */
export const stepIssueMessage = (node: WorkflowNode, issue: string): string =>
  `Étape « ${WORKFLOW_STEP_LABELS[node.type]} » : ${issue}`;

/** A workflow with no step to start from. */
export const NO_STEP_ISSUE = 'Ajoutez au moins une étape.';
