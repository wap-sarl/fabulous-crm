import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { internal } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { WorkflowNode } from '../../convex/_lib/validators/workflows';
import { setExtensionsForTests } from '../../convex/extensions';
import { SCHEDULED_WORK_RETRY_MS } from '../../convex/lib/extensions/types';
import { createTestConvex, pinClock, seedConfig, seedEmployee, seedLead, type T } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const EMAIL_API = 'https://api.brevo.com/v3/smtp/email';
const SMS_API = 'https://api.brevo.com/v3/transactionalSMS/sms';
const HOOK = 'https://hook.example.com/crm';

const ENV = [
  'BREVO_API_KEY',
  'BREVO_SMS_SENDER',
  'DEV_WHITELIST_EMAILS',
  'DEV_WHITELIST_PHONES',
  'SITE_URL',
  'CRM_APP_URL',
] as const;
let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** What the providers and the webhook received, and what they answer next. */
let requests: { url: string; method?: string; headers: Record<string, string>; body: unknown }[] =
  [];
let answer: () => Response;

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.BREVO_API_KEY = 'test-brevo-key';
  process.env.SITE_URL = 'https://crm.example.com';
  const mine: typeof requests = [];
  requests = mine;
  answer = () => new Response(JSON.stringify({ messageId: 'm1' }), { status: 201 });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Another file's background work must neither be counted nor reach the network.
    if (!/api\.brevo\.com|hook\.example\.com/.test(url)) return new Response(null, { status: 503 });
    mine.push({
      url,
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return answer();
  }) as typeof fetch;
});
afterEach(() => {
  setExtensionsForTests(null);
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

type World = { t: T; userId: Id<'users'> };

async function setup(): Promise<World> {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  await seedConfig(t);
  return { t, userId: emp.userId };
}

const email: WorkflowNode = {
  id: 'n1',
  type: 'send_email',
  subject: 'Bonjour {{ params.lastName }}',
  htmlBody:
    '<p>Bonjour {{ params.firstName }} {{ params.lastName }}</p><a href="{{ params.consentUrl }}">Préférences</a>',
  next: 'n2',
};
const sms: WorkflowNode = {
  id: 'n1',
  type: 'send_sms',
  smsBody: 'Bonjour {{ params.firstName }}, votre rendez-vous est confirmé.',
  next: 'n2',
};
const webhook: WorkflowNode = { id: 'n1', type: 'webhook', url: HOOK, next: 'n2' };

const ADDRESS = {
  country: 'FR',
  streetNumber: '12',
  street: 'rue des Lilas',
  postalCode: '69003',
  city: 'Lyon',
};
const LEAD = {
  firstName: 'Jean',
  lastName: "O'Neil",
  email: 'jean@example.com',
  phone: '+33612345678',
  marketingConsent: ['email' as const, 'sms' as const],
  consentToken: 'consent-token-1',
  lifecycleStage: 'lead',
  comment: 'Rappeler mardi',
  address: ADDRESS,
};

type Around = {
  lead?: Partial<Doc<'leads'>>;
  workflow?: Partial<Doc<'workflows'>>;
  run?: Partial<Doc<'workflowRuns'>>;
};

/** A run stopped on a send, as `executeStep` leaves it: the step pending, the action still to run. */
async function pendingStep(w: World, node: WorkflowNode, around: Around = {}) {
  const leadId = await seedLead(w.t, { ...LEAD, ...around.lead });
  return await w.t.run(async (ctx) => {
    const workflowId = await ctx.db.insert('workflows', {
      name: 'Étapes',
      status: 'active',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [node],
      startNodeId: node.id,
      enrolledCount: 1,
      activeCount: 1,
      completedCount: 0,
      updatedAt: NOW,
      createdBy: w.userId,
      updatedBy: w.userId,
      ...around.workflow,
    });
    const runId = await ctx.db.insert('workflowRuns', {
      workflowId,
      leadId,
      status: 'active',
      triggerType: 'manual',
      enrolledAt: NOW,
      currentNodeId: node.id,
      stepCount: 1,
      ...around.run,
    });
    const stepId = await ctx.db.insert('workflowRunSteps', {
      runId,
      workflowId,
      leadId,
      nodeId: node.id,
      nodeType: node.type,
      status: 'pending',
      startedAt: NOW,
    });
    return { workflowId, leadId, runId, stepId, args: { runId, stepId, nodeId: node.id } };
  });
}

type Pending = Awaited<ReturnType<typeof pendingStep>>;

const act = (w: World, s: Pending) =>
  w.t.action(internal.features.workflows.actions.runWorkflowActionStep, s.args);

/** What the action left behind: the step, its run and workflow, and what is scheduled for the run. */
async function after(w: World, s: Pending) {
  return await w.t.run(async (ctx) => {
    const step = await ctx.db.get(s.stepId);
    const run = await ctx.db.get(s.runId);
    const workflow = await ctx.db.get(s.workflowId);
    if (!step || !run || !workflow) throw new Error('step, run or workflow not found');
    const jobs = (await ctx.db.system.query('_scheduled_functions').collect())
      .filter((job) => job.state.kind === 'pending')
      .map((job) => ({
        name: job.name.split(/[:/.]/).at(-1),
        at: job.scheduledTime,
        args: job.args[0] as { runId?: string; nodeId?: string; stepId?: string },
      }))
      .filter((job) => job.args?.runId === s.runId);
    return { step, run, workflow, jobs };
  });
}

/** The run moved to the next node, which is scheduled at once. */
function expectAdvanced(s: Pending, { run, jobs }: Awaited<ReturnType<typeof after>>) {
  expect(run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
  expect(jobs).toEqual([{ name: 'executeStep', at: NOW, args: { runId: s.runId, nodeId: 'n2' } }]);
}

/** A failure is logged by the code under test: the log is kept out of the report. */
async function quietly<R>(run: () => Promise<R>): Promise<R> {
  const error = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = error;
  }
}

describe('the action of a workflow step: an e-mail', () => {
  test('a sent e-mail is written from the contact, succeeds, and the run goes to the next node', async () => {
    const w = await setup();
    const s = await pendingStep(w, email);

    expect(await act(w, s)).toBeNull();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: EMAIL_API,
      method: 'POST',
      headers: { 'api-key': 'test-brevo-key' },
      body: {
        sender: { name: 'CRM', email: 'crm@example.com' },
        to: [{ email: 'jean@example.com' }],
        // A subject is plain text, the body is HTML: only the body escapes what the contact wrote.
        subject: "Bonjour O'Neil",
      },
    });
    const { htmlContent } = requests[0].body as { htmlContent: string };
    expect(htmlContent).toStartWith('<!doctype html>');
    expect(htmlContent).toContain('<p>Bonjour Jean O&#39;Neil</p>');
    expect(htmlContent).toContain('href="https://crm.example.com/consent/consent-token-1"');

    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'success', startedAt: NOW, finishedAt: NOW });
    expect(left.step.detail).toBeUndefined();
    expectAdvanced(s, left);
  });

  test('an e-mail the provider refuses fails the step with its answer, and the run goes on', async () => {
    const w = await setup();
    const s = await pendingStep(w, email);
    const refusal = '{"code":"invalid_parameter","message":"sender is not valid"}';
    answer = () => new Response(refusal, { status: 400 });

    expect(await quietly(() => act(w, s))).toBeNull();

    expect(requests).toHaveLength(1);
    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'failed', detail: refusal, finishedAt: NOW });
    expectAdvanced(s, left);
  });

  test('without a provider the step fails and nothing is sent', async () => {
    const w = await setup();
    delete process.env.BREVO_API_KEY;
    const s = await pendingStep(w, email);

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([]);
    const left = await after(w, s);
    expect(left.step).toMatchObject({
      status: 'failed',
      detail: "Fournisseur d'e-mail non configuré — envoi impossible.",
      finishedAt: NOW,
    });
    expectAdvanced(s, left);
  });

  test('an address outside the development whitelist is not contacted, and the step counts as done', async () => {
    const w = await setup();
    process.env.DEV_WHITELIST_EMAILS = 'dev@example.com,*@wap.example.com';
    const s = await pendingStep(w, email);

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([]);
    const left = await after(w, s);
    expect(left.step).toMatchObject({
      status: 'success',
      detail: 'dev_whitelist_skip',
      finishedAt: NOW,
    });
    expectAdvanced(s, left);

    // An address the whitelist names is contacted.
    const listed = await pendingStep(w, email, { lead: { email: 'ada@wap.example.com' } });
    await act(w, listed);
    expect(requests.map((r) => r.body)).toMatchObject([{ to: [{ email: 'ada@wap.example.com' }] }]);
    expect((await after(w, listed)).step.detail).toBeUndefined();
  });
});

describe('the action of a workflow step: a text message', () => {
  test('a sent message goes to the number in the format of the provider, succeeds, and the run goes on', async () => {
    const w = await setup();
    const s = await pendingStep(w, sms);

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([
      {
        url: SMS_API,
        method: 'POST',
        headers: expect.objectContaining({ 'api-key': 'test-brevo-key' }),
        body: {
          sender: 'CRM',
          recipient: '33612345678',
          content: 'Bonjour Jean, votre rendez-vous est confirmé.',
          type: 'marketing',
        },
      },
    ]);
    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'success', finishedAt: NOW });
    expect(left.step.detail).toBeUndefined();
    expectAdvanced(s, left);
  });

  test('a number written the national way is sent in the international one', async () => {
    const w = await setup();
    const s = await pendingStep(w, sms, { lead: { phone: '06 12 34 56 78' } });
    await act(w, s);
    expect(requests.map((r) => r.body)).toMatchObject([{ recipient: '33612345678' }]);
    expect((await after(w, s)).step.status).toBe('success');
  });

  test('a message the provider refuses fails the step with its answer, and the run goes on', async () => {
    const w = await setup();
    const s = await pendingStep(w, sms);
    const refusal = '{"code":"not_enough_credits","message":"Not enough SMS credits"}';
    answer = () => new Response(refusal, { status: 402 });

    expect(await quietly(() => act(w, s))).toBeNull();

    expect(requests).toHaveLength(1);
    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'failed', detail: refusal, finishedAt: NOW });
    expectAdvanced(s, left);
  });

  test('without a Brevo key, or with a number that is not one, the step fails and nothing is sent', async () => {
    const w = await setup();
    const badNumber = await pendingStep(w, sms, { lead: { phone: '12345' } });
    expect(await act(w, badNumber)).toBeNull();
    const left = await after(w, badNumber);
    expect(left.step).toMatchObject({
      status: 'failed',
      detail: 'Numéro de téléphone invalide : 12345',
      finishedAt: NOW,
    });
    expectAdvanced(badNumber, left);

    delete process.env.BREVO_API_KEY;
    const noKey = await pendingStep(w, sms);
    expect(await act(w, noKey)).toBeNull();
    expect((await after(w, noKey)).step).toMatchObject({
      status: 'failed',
      detail: 'Compte Brevo non configuré — envoi SMS impossible.',
      finishedAt: NOW,
    });
    expect(requests).toEqual([]);
  });

  test('a number outside the development whitelist is not contacted, and the step counts as done', async () => {
    const w = await setup();
    process.env.DEV_WHITELIST_PHONES = '+33600000000';
    const s = await pendingStep(w, sms);

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([]);
    const left = await after(w, s);
    expect(left.step).toMatchObject({
      status: 'success',
      detail: 'dev_whitelist_skip',
      finishedAt: NOW,
    });
    expectAdvanced(s, left);
  });
});

describe('the action of a workflow step: a webhook', () => {
  test('the receiver gets the workflow, the run, the node and the contact without its consent token, and its 2xx is a success', async () => {
    const w = await setup();
    const s = await pendingStep(w, webhook);
    answer = () => new Response('ok', { status: 200 });

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([
      {
        url: HOOK,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          workflow: { id: s.workflowId, name: 'Étapes' },
          run: { id: s.runId, enrolledAt: NOW, triggerType: 'manual' },
          node: { id: 'n1' },
          lead: {
            id: s.leadId,
            firstName: 'Jean',
            lastName: "O'Neil",
            email: 'jean@example.com',
            phone: '+33612345678',
            lifecycleStage: 'lead',
            comment: 'Rappeler mardi',
            address: ADDRESS,
            marketingConsent: ['email', 'sms'],
          },
          timestamp: NOW,
        },
      },
    ]);
    expect(JSON.stringify(requests[0].body)).not.toContain('consent-token-1');
    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'success', detail: 'HTTP 200', finishedAt: NOW });
    expectAdvanced(s, left);
  });

  test('a contact with little on it is sent with what it has', async () => {
    const w = await setup();
    const s = await pendingStep(w, webhook, {
      lead: {
        email: undefined,
        phone: undefined,
        lifecycleStage: undefined,
        comment: undefined,
        address: undefined,
        marketingConsent: [],
      },
    });
    answer = () => new Response(null, { status: 204 });

    expect(await act(w, s)).toBeNull();

    expect((requests[0].body as { lead: unknown }).lead).toEqual({
      id: s.leadId,
      firstName: 'Jean',
      lastName: "O'Neil",
      marketingConsent: [],
    });
    expect((await after(w, s)).step).toMatchObject({ status: 'success', detail: 'HTTP 204' });
  });

  test('an answer outside 2xx fails the step with the status, and the run goes on', async () => {
    const w = await setup();
    const s = await pendingStep(w, webhook);
    answer = () => new Response('boom', { status: 500 });

    expect(await act(w, s)).toBeNull();

    expect(requests).toHaveLength(1);
    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'failed', detail: 'HTTP 500', finishedAt: NOW });
    expectAdvanced(s, left);
  });

  test('a receiver that cannot be reached fails the step with the error, and the run goes on', async () => {
    const w = await setup();
    const s = await pendingStep(w, webhook);
    answer = () => {
      throw new TypeError('fetch failed');
    };

    expect(await quietly(() => act(w, s))).toBeNull();

    const left = await after(w, s);
    expect(left.step).toMatchObject({ status: 'failed', detail: 'fetch failed', finishedAt: NOW });
    expectAdvanced(s, left);
  });
});

describe('the action of a workflow step: the run around it', () => {
  test('the last node of a path completes the run and gives back its place', async () => {
    const w = await setup();
    const s = await pendingStep(w, { ...webhook, next: undefined });
    answer = () => new Response('ok', { status: 200 });

    expect(await act(w, s)).toBeNull();

    const { step, run, workflow, jobs } = await after(w, s);
    expect(step.status).toBe('success');
    expect(run).toMatchObject({ status: 'completed', finishedAt: NOW });
    expect(run.currentNodeId).toBeUndefined();
    expect(workflow).toMatchObject({ activeCount: 0, completedCount: 1 });
    expect(jobs).toEqual([]);
  });

  test('a workflow paused during the send still sends, and parks the run on the next node', async () => {
    const w = await setup();
    const s = await pendingStep(w, email, { workflow: { status: 'paused' } });

    expect(await act(w, s)).toBeNull();

    expect(requests).toHaveLength(1);
    const { step, run, jobs } = await after(w, s);
    expect(step).toMatchObject({ status: 'success', finishedAt: NOW });
    expect(run).toMatchObject({ status: 'active', currentNodeId: 'n2' });
    expect(jobs).toEqual([]);
  });

  test('a run stopped meanwhile skips the step, sends nothing and stays as it was', async () => {
    const w = await setup();
    const s = await pendingStep(w, email, {
      run: { status: 'cancelled', finishedAt: NOW - 1000, currentNodeId: undefined },
    });

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([]);
    const { step, run, workflow, jobs } = await after(w, s);
    expect(step).toMatchObject({
      status: 'skipped',
      detail: 'contexte indisponible',
      finishedAt: NOW,
    });
    expect(run).toMatchObject({ status: 'cancelled', finishedAt: NOW - 1000 });
    expect(workflow.activeCount).toBe(1);
    expect(jobs).toEqual([]);
  });

  test('a contact in the bin, or one that lost its address or its number, skips the step and the run goes on', async () => {
    const w = await setup();
    const cases: [WorkflowNode, Partial<Doc<'leads'>>][] = [
      [webhook, { deletedAt: NOW }],
      [email, { email: undefined }],
      [sms, { phone: undefined }],
    ];
    for (const [node, lead] of cases) {
      const s = await pendingStep(w, node, { lead });
      expect(await act(w, s)).toBeNull();
      const left = await after(w, s);
      expect(left.step).toMatchObject({
        status: 'skipped',
        detail: 'contexte indisponible',
        finishedAt: NOW,
      });
      expectAdvanced(s, left);
    }
    expect(requests).toEqual([]);
  });

  test('a node removed from the graph meanwhile skips the step and fails the run', async () => {
    const w = await setup();
    const s = await pendingStep(w, webhook);
    await w.t.run((ctx) =>
      ctx.db.patch(s.workflowId, {
        nodes: [{ id: 'other', type: 'wait', amount: 1, unit: 'hours' }],
        startNodeId: 'other',
      }),
    );

    expect(await act(w, s)).toBeNull();

    expect(requests).toEqual([]);
    const { step, run, workflow, jobs } = await after(w, s);
    expect(step).toMatchObject({ status: 'skipped', detail: 'contexte indisponible' });
    expect(run).toMatchObject({ status: 'failed', error: 'step_removed', finishedAt: NOW });
    expect(run.currentNodeId).toBeUndefined();
    expect(workflow.activeCount).toBe(0);
    expect(jobs).toEqual([]);
  });

  test('an action that runs twice sends once and leaves the step as the first run wrote it', async () => {
    const w = await setup();
    const s = await pendingStep(w, webhook);
    answer = () => new Response('ok', { status: 200 });
    await act(w, s);
    const first = await after(w, s);

    expect(await act(w, s)).toBeNull();

    expect(requests).toHaveLength(1);
    expect(await after(w, s)).toEqual(first);
    expect(first.step).toMatchObject({ status: 'success', detail: 'HTTP 200' });
  });

  test('an action the deployment defers sends nothing, leaves the step pending and comes back later with the same arguments', async () => {
    const w = await setup();
    const asked: string[] = [];
    setExtensionsForTests({
      beforeScheduledWork: async (_ctx, { kind }) => {
        asked.push(kind);
        return false;
      },
    });
    const s = await pendingStep(w, email);

    expect(await act(w, s)).toBeNull();

    expect(asked).toEqual(['workflow_action']);
    expect(requests).toEqual([]);
    const { step, run, workflow, jobs } = await after(w, s);
    expect(step.status).toBe('pending');
    expect(step.finishedAt).toBeUndefined();
    expect(step.detail).toBeUndefined();
    expect(run).toMatchObject({ status: 'active', currentNodeId: 'n1', stepCount: 1 });
    expect(workflow.activeCount).toBe(1);
    expect(jobs).toEqual([
      { name: 'runWorkflowActionStep', at: NOW + SCHEDULED_WORK_RETRY_MS, args: s.args },
    ]);

    // Allowed again, the same call sends.
    setExtensionsForTests(null);
    await act(w, s);
    expect(requests).toHaveLength(1);
    expect((await after(w, s)).step).toMatchObject({ status: 'success', finishedAt: NOW });
  });
});
