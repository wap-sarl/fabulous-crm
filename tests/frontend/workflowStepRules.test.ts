import { describe, expect, test } from 'bun:test';
import type { Doc } from '../../convex/_generated/dataModel';
import type { WorkflowNode } from '../../convex/_lib/validators/workflows';
import { validateWorkflowGraph } from '../../convex/lib/workflows/rules';
import { validateWorkflowDraft } from '../../src/features/workflows/lib/validation';

const rule = { field: { kind: 'standard', field: 'email' }, operator: 'isNotEmpty' } as const;
const condition = (rules: unknown[]) =>
  ({ combinator: 'and', groups: [{ combinator: 'and', rules }] }) as never;

/** A step of each kind that both sides accept. */
const VALID: { [K in WorkflowNode['type']]: Extract<WorkflowNode, { type: K }> } = {
  send_email: { id: 'n', type: 'send_email', subject: 'Bonjour', htmlBody: '<p>Bonjour</p>' },
  send_sms: { id: 'n', type: 'send_sms', smsBody: 'Bonjour' },
  update_property: {
    id: 'n',
    type: 'update_property',
    target: { kind: 'standard', field: 'comment' },
    value: 'À rappeler',
  },
  set_lifecycle_stage: { id: 'n', type: 'set_lifecycle_stage', stage: 'lead' },
  create_deal: { id: 'n', type: 'create_deal', title: 'Contrat', amount: 0 },
  update_deal_stage: { id: 'n', type: 'update_deal_stage', stageKey: 'new' },
  create_task: { id: 'n', type: 'create_task', title: 'Rappeler', dueInDays: 365 },
  add_to_list: { id: 'n', type: 'add_to_list', listId: 'list1' as never },
  remove_from_list: { id: 'n', type: 'remove_from_list', listId: 'list1' as never },
  wait: { id: 'n', type: 'wait', amount: 90, unit: 'days' },
  webhook: { id: 'n', type: 'webhook', url: 'https://example.com/hook' },
  branch: { id: 'n', type: 'branch', condition: condition([rule]) },
};

const pipeline = {
  _id: 'p1',
  name: 'Ventes',
  stages: [{ key: 'new', label: 'Nouveau', kind: 'open' }],
} as unknown as Doc<'pipelines'>;

/** What the backend answers when the workflow is activated. */
const backend = (node: WorkflowNode) =>
  validateWorkflowGraph(
    [node],
    node.id,
    new Map(),
    new Set(['list1']),
    new Set(['lead']),
    new Map([['p1', pipeline]]),
  );

/** What the editor shows before it lets the workflow be activated. */
const editor = (node: WorkflowNode) =>
  validateWorkflowDraft({
    name: 'Relance',
    trigger: { type: 'lead_created' },
    allowReEnrollment: false,
    nodes: { [node.id]: node },
    startNodeId: node.id,
  });

/** Each refusal: the step, what is wrong with it, the words. */
const REFUSED: [string, WorkflowNode, string][] = [
  [
    'an e-mail without a subject',
    { ...VALID.send_email, subject: ' ' },
    'Étape « Envoyer un e-mail » : l’objet est requis.',
  ],
  [
    'an e-mail without content',
    { ...VALID.send_email, htmlBody: ' ' },
    'Étape « Envoyer un e-mail » : le contenu est requis.',
  ],
  [
    'an e-mail whose content is the empty paragraph of the editor',
    { ...VALID.send_email, htmlBody: '<p></p>' },
    'Étape « Envoyer un e-mail » : le contenu est requis.',
  ],
  [
    'an e-mail with neither: the subject first',
    { ...VALID.send_email, subject: '', htmlBody: '' },
    'Étape « Envoyer un e-mail » : l’objet est requis.',
  ],
  [
    'an SMS without a message',
    { ...VALID.send_sms, smsBody: '  ' },
    'Étape « Envoyer un SMS » : le message est requis.',
  ],
  [
    'a property without a value',
    { ...VALID.update_property, value: '' },
    'Étape « Modifier une propriété » : choisissez une valeur.',
  ],
  [
    'a property with an empty choice',
    { ...VALID.update_property, value: [] },
    'Étape « Modifier une propriété » : choisissez une valeur.',
  ],
  [
    'no lifecycle stage',
    { ...VALID.set_lifecycle_stage, stage: undefined },
    'Étape « Changer le statut » : choisissez un statut.',
  ],
  [
    'an empty lifecycle stage',
    { ...VALID.set_lifecycle_stage, stage: '' },
    'Étape « Changer le statut » : choisissez un statut.',
  ],
  [
    'a deal without a title',
    { ...VALID.create_deal, title: ' ' },
    'Étape « Créer une transaction » : l’intitulé est requis.',
  ],
  [
    'a deal with a negative amount',
    { ...VALID.create_deal, amount: -1 },
    'Étape « Créer une transaction » : montant invalide.',
  ],
  [
    'a deal with an amount that is not a number',
    { ...VALID.create_deal, amount: Number.NaN },
    'Étape « Créer une transaction » : montant invalide.',
  ],
  [
    'a deal with neither: the title first',
    { ...VALID.create_deal, title: '', amount: -1 },
    'Étape « Créer une transaction » : l’intitulé est requis.',
  ],
  [
    'no deal stage',
    { ...VALID.update_deal_stage, stageKey: undefined },
    'Étape « Changer le stade d’une transaction » : choisissez un stade.',
  ],
  [
    'a task without a title',
    { ...VALID.create_task, title: '' },
    'Étape « Créer une tâche » : l’intitulé est requis.',
  ],
  [
    'a task due in more than a year',
    { ...VALID.create_task, dueInDays: 366 },
    'Étape « Créer une tâche » : échéance invalide (0 à 365 jours).',
  ],
  [
    'a task due in the past',
    { ...VALID.create_task, dueInDays: -1 },
    'Étape « Créer une tâche » : échéance invalide (0 à 365 jours).',
  ],
  [
    'a task due in half a day',
    { ...VALID.create_task, dueInDays: 1.5 },
    'Étape « Créer une tâche » : échéance invalide (0 à 365 jours).',
  ],
  [
    'no list to add to',
    { ...VALID.add_to_list, listId: undefined },
    'Étape « Ajouter à une liste » : choisissez une liste.',
  ],
  [
    'no list to remove from',
    { ...VALID.remove_from_list, listId: undefined },
    'Étape « Retirer d’une liste » : choisissez une liste.',
  ],
  ['a wait of nothing', { ...VALID.wait, amount: 0 }, 'Étape « Attendre » : durée invalide.'],
  ['a wait of half a day', { ...VALID.wait, amount: 0.5 }, 'Étape « Attendre » : durée invalide.'],
  [
    'a wait that is not a number',
    { ...VALID.wait, amount: Number.NaN },
    'Étape « Attendre » : durée invalide.',
  ],
  [
    'a wait of 91 days',
    { ...VALID.wait, amount: 91 },
    'Étape « Attendre » : durée maximale 90 jours.',
  ],
  [
    'a wait of more than 90 days, in hours',
    { ...VALID.wait, amount: 90 * 24 + 1, unit: 'hours' },
    'Étape « Attendre » : durée maximale 90 jours.',
  ],
  [
    'a wait of more than 90 days, in minutes',
    { ...VALID.wait, amount: 90 * 24 * 60 + 1, unit: 'minutes' },
    'Étape « Attendre » : durée maximale 90 jours.',
  ],
  [
    'a webhook that is not an http address',
    { ...VALID.webhook, url: 'example.com/hook' },
    'Étape « Webhook » : l’URL doit commencer par http(s)://',
  ],
  [
    'a webhook that is a scheme and nothing else',
    { ...VALID.webhook, url: 'https://' },
    'Étape « Webhook » : l’URL doit commencer par http(s)://',
  ],
  [
    'a condition without a rule',
    { ...VALID.branch, condition: condition([]) },
    'Étape « Condition (Si / Sinon) » : au moins une condition est requise.',
  ],
  [
    'a condition whose only rule is not filled',
    { ...VALID.branch, condition: condition([{ ...rule, operator: 'equals', value: '' }]) },
    'Étape « Condition (Si / Sinon) » : au moins une condition est requise.',
  ],
];

describe('what a step must hold before its workflow runs', () => {
  for (const node of Object.values(VALID)) {
    test(`${node.type}: a filled step passes on both sides`, () => {
      expect(backend(node)).toBeNull();
      expect(editor(node)).toEqual([]);
    });
  }

  test('the bounds are inside: 90 days in hours and in minutes, an amount and a due date left out', () => {
    for (const node of [
      { ...VALID.wait, amount: 90 * 24, unit: 'hours' as const },
      { ...VALID.wait, amount: 90 * 24 * 60, unit: 'minutes' as const },
      { ...VALID.wait, amount: 1, unit: 'minutes' as const },
      { ...VALID.create_deal, amount: undefined },
      { ...VALID.create_task, dueInDays: undefined },
      { ...VALID.create_task, dueInDays: 0 },
      {
        ...VALID.update_property,
        target: { kind: 'standard' as const, field: 'isRedFlagged' as const },
        value: false,
      },
    ]) {
      expect(backend(node)).toBeNull();
      expect(editor(node)).toEqual([]);
    }
  });

  for (const [what, node, message] of REFUSED) {
    test(`${what}: the backend and the editor refuse it with the same words`, () => {
      expect(backend(node)).toBe(message);
      expect(editor(node)).toEqual([{ message, nodeId: 'n' }]);
    });
  }

  test('the editor names every step at fault, the backend the first one', () => {
    const first = { ...VALID.send_sms, id: 'a', smsBody: '', next: 'b' };
    const second = { ...VALID.webhook, id: 'b', url: 'nope' };
    expect(
      validateWorkflowDraft({
        name: 'Relance',
        trigger: { type: 'lead_created' },
        allowReEnrollment: false,
        nodes: { a: first, b: second },
        startNodeId: 'a',
      }),
    ).toEqual([
      { message: 'Étape « Envoyer un SMS » : le message est requis.', nodeId: 'a' },
      { message: 'Étape « Webhook » : l’URL doit commencer par http(s)://', nodeId: 'b' },
    ]);
    expect(
      validateWorkflowGraph([first, second], 'a', new Map(), new Set(), new Set(), new Map()),
    ).toBe('Étape « Envoyer un SMS » : le message est requis.');
  });

  test('what only the database can tell comes after what the step holds', () => {
    expect(backend({ ...VALID.set_lifecycle_stage, stage: 'gone' })).toBe(
      'Étape « Changer le statut » : statut introuvable.',
    );
    expect(backend({ ...VALID.add_to_list, listId: 'gone' as never })).toBe(
      'Étape « Ajouter à une liste » : liste introuvable.',
    );
    expect(backend({ ...VALID.update_deal_stage, stageKey: 'gone' })).toBe(
      'Étape « Changer le stade d’une transaction » : stade introuvable.',
    );
    expect(backend({ ...VALID.create_deal, stageKey: 'gone' })).toBe(
      'Étape « Créer une transaction » : stade introuvable.',
    );
    expect(backend({ ...VALID.update_property, value: '   ' })).toBe(
      'Étape « Modifier une propriété » : texte requis.',
    );
    expect(
      validateWorkflowGraph([VALID.create_deal], 'n', new Map(), new Set(), new Set(), new Map()),
    ).toBe('Étape « Créer une transaction » : aucun pipeline.');
  });

  test('a workflow without a name, a trigger or a step is the editor’s to say', () => {
    expect(
      validateWorkflowDraft({
        name: ' ',
        trigger: null,
        allowReEnrollment: false,
        nodes: {},
        startNodeId: null,
      }),
    ).toEqual([
      { message: 'Le nom du workflow est requis.' },
      { message: 'Choisissez un événement déclencheur.', nodeId: 'trigger' },
      { message: 'Ajoutez au moins une étape.' },
    ]);
    expect(validateWorkflowGraph([], undefined, new Map(), new Set(), new Set(), new Map())).toBe(
      'Ajoutez au moins une étape.',
    );
  });
});
