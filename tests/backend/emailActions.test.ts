import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { api, internal } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedConfig, seedEmployee, type T } from './helpers';

const ENV = [
  'BREVO_API_KEY',
  'BREVO_WEBHOOK_SECRET',
  'BREVO_SMS_WEBHOOK_SECRET',
  'CONVEX_SITE_URL',
  'SECRETS_KEY',
  'SECRETS_KEY_NEXT',
  'EMAIL_SENDER_NAME',
  'EMAIL_SENDER_EMAIL',
] as const;
const SITE = 'https://crm-123.convex.site';
const BREVO = 'https://api.brevo.com/v3';

type BrevoRequest = { method: string; path: string; apiKey: string | null; body: unknown };
type Answer = { status: number; body?: unknown };

let saved: Record<string, string | undefined> = {};
let previousFetch: typeof fetch;
/** Brevo's side: every request it received, and what it answers to each, in order. */
let requests: BrevoRequest[] = [];
let answers: Answer[] = [];

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.CONVEX_SITE_URL = SITE;
  const mine: BrevoRequest[] = [];
  const queue: Answer[] = [];
  requests = mine;
  answers = queue;
  previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Anything else than Brevo stays refused.
    if (!url.startsWith(BREVO)) return previousFetch(input, init);
    mine.push({
      method: init?.method ?? 'GET',
      path: url.slice(BREVO.length),
      apiKey: new Headers(init?.headers).get('api-key'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = queue.shift();
    if (!answer) return new Response('no answer left', { status: 500 });
    const text = answer.body === undefined ? null : JSON.stringify(answer.body);
    return new Response(text, { status: answer.status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = previousFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const brevoFromEnv = () => {
  process.env.BREVO_API_KEY = 'env-key';
  process.env.BREVO_WEBHOOK_SECRET = 'env-secret';
};

const storedBrevo = (provider: 'brevo' | 'smtp'): Doc<'appConfig'>['email'] => ({
  provider,
  brevoApiKey: 'stored-key',
  brevoWebhookSecret: 'stored-secret',
  ...(provider === 'smtp' ? { smtpHost: 'smtp.example.com' } : {}),
});

describe('the e-mail webhook registered at Brevo', () => {
  const register = (t: T) =>
    t.action(internal.features.campaigns.actions.registerBrevoEmailWebhook, {});
  const endpoint = `${SITE}/webhooks/brevo/email`;

  test('under SMTP nothing is registered, and Brevo is not called', async () => {
    const t = createTestConvex();
    await seedConfig(t, { email: storedBrevo('smtp') });

    expect(await register(t)).toEqual({ action: 'skipped', reason: 'provider_not_brevo' });
    expect(requests).toEqual([]);
  });

  test('with no webhook at Brevo, one is created with the secret in a header', async () => {
    const t = createTestConvex();
    brevoFromEnv();
    // Brevo answers an error, not an empty list, when the account has no webhook.
    answers.push(
      { status: 404, body: { code: 'document_not_found', message: 'No webhooks found' } },
      { status: 201, body: { id: 7 } },
    );

    expect(await register(t)).toEqual({ action: 'created', id: 7, url: endpoint });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /webhooks?type=transactional',
      'POST /webhooks',
    ]);
    expect(requests.map((r) => r.apiKey)).toEqual(['env-key', 'env-key']);
    expect(requests[1].body).toMatchObject({
      type: 'transactional',
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: 'env-secret' }],
    });
    const { events } = requests[1].body as { events: string[] };
    expect(events).toContain('opened');
    expect(events).toContain('hardBounce');
    // `opened` already reports the first open.
    expect(events).not.toContain('uniqueOpened');
  });

  test('the webhooks of others are left alone: ours is created beside them', async () => {
    const t = createTestConvex();
    brevoFromEnv();
    answers.push(
      { status: 200, body: { webhooks: [{ id: 3, url: 'https://other.example.com/hook' }] } },
      { status: 201, body: { id: 8 } },
    );

    expect(await register(t)).toEqual({ action: 'created', id: 8, url: endpoint });
    expect(requests[1]).toMatchObject({ method: 'POST', path: '/webhooks' });
  });

  test('run again, the webhook already there is updated, with the key and the secret of the settings', async () => {
    const t = createTestConvex();
    await seedConfig(t, { email: storedBrevo('brevo') });
    answers.push(
      {
        status: 200,
        body: {
          webhooks: [
            { id: 3, url: 'https://other.example.com/hook' },
            { id: 12, url: endpoint },
          ],
        },
      },
      // An update answers with no content.
      { status: 204 },
    );

    expect(await register(t)).toEqual({ action: 'updated', id: 12, url: endpoint });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /webhooks?type=transactional',
      'PUT /webhooks/12',
    ]);
    expect(requests[1].apiKey).toBe('stored-key');
    expect(requests[1].body).toMatchObject({
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: 'stored-secret' }],
    });
  });

  test('a missing key, secret or site address stops before Brevo is called', async () => {
    const t = createTestConvex();
    await expect(register(t)).rejects.toThrow('Configuration manquante : BREVO_API_KEY');
    process.env.BREVO_API_KEY = 'env-key';
    await expect(register(t)).rejects.toThrow('Configuration manquante : BREVO_WEBHOOK_SECRET');
    process.env.BREVO_WEBHOOK_SECRET = 'env-secret';
    delete process.env.CONVEX_SITE_URL;
    await expect(register(t)).rejects.toThrow('Configuration manquante : CONVEX_SITE_URL');
    expect(requests).toEqual([]);
  });

  test('a refusal of Brevo, on the list or on the write, is an error that says what Brevo answered', async () => {
    const t = createTestConvex();
    brevoFromEnv();
    answers.push({ status: 401, body: { code: 'unauthorized', message: 'Key not found' } });
    await expect(register(t)).rejects.toThrow(
      'Brevo GET /webhooks a échoué : {"code":"unauthorized","message":"Key not found"}',
    );
    expect(requests).toHaveLength(1);

    answers.push(
      { status: 404, body: { code: 'document_not_found' } },
      { status: 400, body: { code: 'invalid_parameter', message: 'Invalid url' } },
    );
    await expect(register(t)).rejects.toThrow(
      'Brevo POST /webhooks a échoué : {"code":"invalid_parameter","message":"Invalid url"}',
    );

    answers.push(
      { status: 200, body: { webhooks: [{ id: 12, url: endpoint }] } },
      { status: 400, body: { code: 'invalid_parameter' } },
    );
    await expect(register(t)).rejects.toThrow(
      'Brevo PUT /webhooks a échoué : {"code":"invalid_parameter"}',
    );
  });
});

describe('the text message webhook registered at Brevo', () => {
  const register = (t: T) =>
    t.action(internal.features.campaigns.actions.registerBrevoSmsWebhook, {});
  const endpoint = `${SITE}/webhooks/brevo/sms`;

  test('with no webhook at Brevo, one is created for what a recipient sends back, even under SMTP', async () => {
    const t = createTestConvex();
    await seedConfig(t, { email: storedBrevo('smtp') });
    answers.push(
      { status: 404, body: { code: 'document_not_found' } },
      { status: 201, body: { id: 21 } },
    );

    expect(await register(t)).toEqual({ action: 'created', id: 21, url: endpoint });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /webhooks?type=transactional&channel=sms',
      'POST /webhooks',
    ]);
    expect(requests[1].apiKey).toBe('stored-key');
    expect(requests[1].body).toMatchObject({
      type: 'transactional',
      channel: 'sms',
      url: endpoint,
      headers: [{ key: 'x-webhook-secret', value: 'stored-secret' }],
      events: ['reply', 'unsubscribe', 'blacklisted'],
    });
  });

  test('run again, the webhook already there is updated', async () => {
    const t = createTestConvex();
    brevoFromEnv();
    answers.push(
      {
        status: 200,
        body: {
          webhooks: [
            { id: 12, url: `${SITE}/webhooks/brevo/email` },
            { id: 22, url: endpoint },
          ],
        },
      },
      { status: 204 },
    );

    expect(await register(t)).toEqual({ action: 'updated', id: 22, url: endpoint });
    expect(requests[1]).toMatchObject({ method: 'PUT', path: '/webhooks/22', apiKey: 'env-key' });
  });

  test('a missing key or secret, and a refusal of Brevo, are errors', async () => {
    const t = createTestConvex();
    await expect(register(t)).rejects.toThrow('Configuration manquante : BREVO_API_KEY');
    process.env.BREVO_API_KEY = 'env-key';
    await expect(register(t)).rejects.toThrow('Configuration manquante : BREVO_WEBHOOK_SECRET');
    expect(requests).toEqual([]);

    process.env.BREVO_WEBHOOK_SECRET = 'env-secret';
    answers.push({ status: 401, body: { code: 'unauthorized' } });
    await expect(register(t)).rejects.toThrow(
      'Brevo GET /webhooks a échoué : {"code":"unauthorized"}',
    );
    answers.push(
      { status: 404, body: { code: 'document_not_found' } },
      { status: 400, body: { code: 'invalid_parameter' } },
    );
    await expect(register(t)).rejects.toThrow(
      'Brevo POST /webhooks a échoué : {"code":"invalid_parameter"}',
    );
  });
});

/** A mail server on this machine that accepts everything and keeps what it was told. */
async function smtpServer(): Promise<{ port: number; lines: string[]; server: Server }> {
  const lines: string[] = [];
  const server = createServer((socket) => {
    let inData = false;
    let pending = '';
    socket.on('error', () => {});
    socket.write('220 localhost ESMTP\r\n');
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      if (inData) {
        if (!pending.endsWith('\r\n.\r\n')) return;
        lines.push(...pending.split('\r\n'));
        pending = '';
        inData = false;
        socket.write('250 queued\r\n');
        return;
      }
      const received = pending.split('\r\n');
      pending = received.pop() ?? '';
      for (const line of received) {
        lines.push(line);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (verb === 'AUTH') socket.write('235 authenticated\r\n');
        else if (verb === 'DATA') {
          inData = true;
          socket.write('354 go ahead\r\n');
        } else if (verb === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { port: address.port, lines, server };
}

const closed = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

describe('the test e-mail of the settings', () => {
  async function setup(config?: Parameters<typeof seedConfig>[1]) {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
    if (config) await seedConfig(t, config);
    return { t, as: asIdentity(t, emp.identity) };
  }
  const send = (as: ReturnType<typeof asIdentity>) =>
    as.action(api.features.email.actions.sendTestEmail, { to: 'ada@example.com' });

  test('through Brevo, the answer says who sent it and carries the id Brevo gave to the message', async () => {
    const { as } = await setup({
      senderName: 'Fabulous',
      senderEmail: 'hello@example.com',
      email: { provider: 'brevo', brevoApiKey: 'stored-key' },
    });
    answers.push({ status: 201, body: { messageId: '<202610010900.1@smtp-relay.example.com>' } });

    expect(await send(as)).toEqual({
      to: 'ada@example.com',
      provider: 'brevo',
      from: { name: 'Fabulous', email: 'hello@example.com' },
      ok: true,
      status: 201,
      error: undefined,
      messageId: '<202610010900.1@smtp-relay.example.com>',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      path: '/smtp/email',
      apiKey: 'stored-key',
      body: {
        sender: { name: 'Fabulous', email: 'hello@example.com' },
        to: [{ email: 'ada@example.com' }],
        subject: '[CRM] E-mail de test',
      },
    });
  });

  test('a refusal of Brevo comes back as it was answered, for the admin to read', async () => {
    const { as } = await setup({ email: { provider: 'brevo', brevoApiKey: 'stored-key' } });
    answers.push({ status: 401, body: { code: 'unauthorized', message: 'Key not found' } });
    const logged = spyOn(console, 'error').mockImplementation(() => {});

    const result = await send(as);
    logged.mockRestore();
    expect(result).toEqual({
      to: 'ada@example.com',
      provider: 'brevo',
      from: { name: 'CRM', email: 'crm@example.com' },
      ok: false,
      status: 401,
      error: '{"code":"unauthorized","message":"Key not found"}',
      messageId: undefined,
    });
  });

  test('with no settings saved, the key of the environment and the default sender are used, and an answer with no id is still a success', async () => {
    const { as } = await setup();
    process.env.BREVO_API_KEY = 'env-key';
    answers.push({ status: 202 });

    expect(await send(as)).toEqual({
      to: 'ada@example.com',
      provider: 'brevo',
      from: { name: 'CRM', email: 'noreply@example.com' },
      ok: true,
      status: 202,
      error: undefined,
      messageId: undefined,
    });
    expect(requests[0].apiKey).toBe('env-key');
  });

  test('through SMTP, the message reaches the server of the settings and the answer carries its id', async () => {
    const mail = await smtpServer();
    const { as } = await setup({
      email: {
        provider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: mail.port,
        smtpSecure: false,
        smtpUser: 'mailer',
        smtpPass: 'smtp-pass',
      },
    });

    const result = await send(as);
    await closed(mail.server);
    expect(result).toEqual({
      to: 'ada@example.com',
      provider: 'smtp',
      from: { name: 'CRM', email: 'crm@example.com' },
      ok: true,
      status: 200,
      error: undefined,
      messageId: expect.stringMatching(/^<.+@example\.com>$/),
    });
    expect(mail.lines).toContain('MAIL FROM:<crm@example.com>');
    expect(mail.lines).toContain('RCPT TO:<ada@example.com>');
    expect(mail.lines).toContain('Subject: [CRM] E-mail de test');
    expect(requests).toEqual([]);
  });

  test('an SMTP server that does not answer is a failure with the reason, and no status', async () => {
    const mail = await smtpServer();
    await closed(mail.server);
    const { as } = await setup({
      email: { provider: 'smtp', smtpHost: '127.0.0.1', smtpPort: mail.port },
    });
    const logged = spyOn(console, 'error').mockImplementation(() => {});

    const result = await send(as);
    logged.mockRestore();
    expect(result).toMatchObject({
      to: 'ada@example.com',
      provider: 'smtp',
      from: { name: 'CRM', email: 'crm@example.com' },
      ok: false,
      status: 0,
    });
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.messageId).toBeUndefined();
  });

  test('someone who is not signed in sends nothing', async () => {
    const { t } = await setup({ email: { provider: 'brevo', brevoApiKey: 'stored-key' } });

    await expect(
      t.action(api.features.email.actions.sendTestEmail, { to: 'ada@example.com' }),
    ).rejects.toThrow('Unauthorized: employees only');
    expect(requests).toEqual([]);
  });
});
