import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { signState, verifyState } from '../../convex/lib/connectors';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

const ENV = [
  'BETTER_AUTH_SECRET',
  'OAUTH_STATE_SECRET',
  'OAUTH_CALLBACK_BASE',
  'OAUTH_CALLBACK_TENANT',
  'CONVEX_SITE_URL',
  'SITE_URL',
  'SECRETS_KEY',
  'CONNECTOR_GOOGLE_CLIENT_ID',
  'CONNECTOR_GOOGLE_CLIENT_SECRET',
  'CONNECTOR_MICROSOFT_CLIENT_ID',
  'CONNECTOR_MICROSOFT_CLIENT_SECRET',
] as const;
let saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
/** The provider's side: every request it received, and what its token endpoint answers next. */
let requests: { url: string; form: Record<string, string> }[] = [];
let tokenAnswer: { status: number; body: Record<string, unknown> };
const opened: T[] = [];

/** A JWT whose payload carries the claims; the signature is never read (the token comes straight from the token endpoint). */
const idToken = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const GRANT = {
  access_token: 'access-1',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  scope: 'openid email profile',
  id_token: idToken({ sub: 'google-sub-1', email: 'ada@example.com' }),
};

beforeEach(() => {
  saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  process.env.CONVEX_SITE_URL = 'https://crm-123.convex.site';
  process.env.SITE_URL = 'https://crm.example.com';
  process.env.SECRETS_KEY = 'a'.repeat(64);
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-18T10:00:00Z'));
  const mine: typeof requests = [];
  requests = mine;
  tokenAnswer = { status: 200, body: GRANT };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    // Another file's background work must neither be counted nor reach the network.
    if (!/googleapis\.com|microsoftonline\.com/.test(url))
      return new Response(null, { status: 503 });
    mine.push({ url, form: Object.fromEntries(new URLSearchParams(String(init?.body))) });
    if (url.includes('/revoke')) return new Response(null, { status: 200 });
    return new Response(JSON.stringify(tokenAnswer.body), { status: tokenAnswer.status });
  }) as typeof fetch;
});
afterEach(async () => {
  for (const t of opened.splice(0)) await t.finishAllScheduledFunctions(() => jest.runAllTimers());
  jest.useRealTimers();
  globalThis.fetch = realFetch;
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function setup() {
  const t = createTestConvex();
  opened.push(t);
  const emp = await seedEmployee(t, {
    email: 'admin@example.com',
    role: 'admin',
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  });
  const as = asIdentity(t, emp.identity);
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'Test',
      appUrl: 'https://crm.example.com',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      updatedAt: Date.now(),
    }),
  );
  await as.mutation(api.features.config.mutations.updateConfig, {
    connectors: [
      {
        provider: 'google',
        clientId: 'own-google-id',
        clientSecret: 'own-google-secret',
        enabled: true,
      },
    ],
  });
  return { t, as, emp };
}
type As = ReturnType<typeof asIdentity>;

const start = async (as: As, provider: 'google' | 'microsoft' = 'google') =>
  new URL((await as.mutation(api.features.connectors.mutations.startConnection, { provider })).url);
const callback = (t: T, query: Record<string, string>) =>
  t.fetch(`/connectors/callback?${new URLSearchParams(query)}`, { method: 'GET' });
const accounts = (t: T) => t.run((ctx) => ctx.db.query('connectorAccounts').collect());
const pendings = (t: T) => t.run((ctx) => ctx.db.query('connectorPendingAccounts').collect());
const finishOf = (response: Response) =>
  new URL(response.headers.get('Location')!).searchParams.get('finish')!;
const finish = (as: As, token: string) =>
  as.mutation(api.features.connectors.mutations.finishConnection, { token });
/** The whole return trip: the callback parks the grant, the signed-in page claims it. */
const connect = async (t: T, as: As, state: string, code = 'auth-code') =>
  finish(as, finishOf(await callback(t, { code, state })));
const challengeOf = async (verifier: string) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString(
    'base64url',
  );

describe('connector state', () => {
  test('round trip; an expired, forged, truncated or foreign state is refused', async () => {
    const payload = {
      t: 'acme',
      p: 'google' as const,
      n: 'nonce',
      e: Math.floor(Date.now() / 1000) + 60,
    };
    const state = await signState(payload);
    expect(await verifyState(state)).toEqual(payload);
    expect(await verifyState(state, Date.now() + 61_000)).toBeNull();
    const [body, signature] = state.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...payload, t: 'victim' })).toString('base64url');
    expect(await verifyState(`${forged}.${signature}`)).toBeNull();
    expect(await verifyState(`${body}.${signature.slice(0, -2)}AA`)).toBeNull();
    expect(await verifyState(body)).toBeNull();
    expect(await verifyState(`${state}.extra`)).toBeNull();
    expect(await verifyState('')).toBeNull();
    // Signed under another key (another deployment, or an attacker's guess).
    process.env.OAUTH_STATE_SECRET = 'someone-else';
    expect(await verifyState(state)).toBeNull();
    const unknown = await signState({ ...payload, p: 'dropbox' as never });
    expect(await verifyState(unknown)).toBeNull();
    // A name every object inherits is not a provider.
    const inherited = await signState({ ...payload, p: 'constructor' as never });
    expect(await verifyState(inherited)).toBeNull();
  });
});

describe('connecting an account', () => {
  test('the consent URL carries a one-time state and a PKCE challenge; the callback exchanges the code here, the signed-in user claims the account', async () => {
    const { t, as, emp } = await setup();
    const url = await start(as);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = url.searchParams;
    expect(Object.fromEntries(q)).toMatchObject({
      client_id: 'own-google-id',
      redirect_uri: 'https://crm-123.convex.site/connectors/callback',
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });
    const state = q.get('state')!;
    const payload = (await verifyState(state))!;
    expect(payload).toMatchObject({ t: '', p: 'google' });
    // The nonce is stored hashed, with the PKCE verifier the challenge was made from.
    const [pending] = await t.run((ctx) => ctx.db.query('connectorStates').collect());
    expect(pending!.nonceHash).not.toContain(payload.n);
    expect(await challengeOf(pending!.codeVerifier)).toBe(q.get('code_challenge')!);

    const response = await callback(t, { code: 'auth-code', state });
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toMatch(
      /^https:\/\/crm\.example\.com\/settings\/integrations\?finish=[\w-]{43}$/,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(requests).toEqual([
      {
        url: 'https://oauth2.googleapis.com/token',
        form: {
          grant_type: 'authorization_code',
          code: 'auth-code',
          redirect_uri: 'https://crm-123.convex.site/connectors/callback',
          client_id: 'own-google-id',
          client_secret: 'own-google-secret',
          code_verifier: pending!.codeVerifier,
        },
      },
    ]);
    // The callback links nothing: the grant waits as ciphertext under the hash of the finish token.
    expect(await accounts(t)).toEqual([]);
    const [parked] = await pendings(t);
    expect(parked).toMatchObject({ userId: emp.userId, expiresAt: Date.now() + 5 * 60_000 });
    expect(JSON.stringify(parked)).not.toMatch(/refresh-1|access-1/);
    expect(JSON.stringify(parked)).not.toContain(finishOf(response));
    expect(await finish(as, finishOf(response))).toEqual({ ok: true, provider: 'google' });
    expect(await pendings(t)).toEqual([]);
    const [account] = await accounts(t);
    expect(account).toMatchObject({
      userId: emp.userId,
      provider: 'google',
      providerAccountId: 'google-sub-1',
      email: 'ada@example.com',
      scopes: ['openid', 'email', 'profile'],
      status: 'active',
      accessTokenExpiresAt: Date.now() + 3600_000,
    });
    expect(account!.refreshToken).toMatch(/^v1:/);
    expect(account!.accessToken).toMatch(/^v1:/);
    expect(JSON.stringify(account)).not.toContain('refresh-1');
    // No query returns a token, in clear or not.
    const overview = await as.query(api.features.connectors.queries.overview, {});
    expect(overview.find((p) => p.provider === 'google')).toEqual({
      provider: 'google',
      label: 'Google',
      source: 'own',
      account: {
        email: 'ada@example.com',
        scopes: ['openid', 'email', 'profile'],
        status: 'active',
        connectedAt: Date.now(),
      },
    });
    expect(JSON.stringify(overview)).not.toMatch(/refresh|access-1|v1:/);
    expect(await t.run((ctx) => ctx.db.query('connectorStates').collect())).toEqual([]);
  });

  test('only the user who started the connection can claim it: anyone else burns the token and the grant is revoked', async () => {
    const { t, as } = await setup();
    const victim = asIdentity(
      t,
      (await seedEmployee(t, { email: 'victim@example.com', sessionTtlMs: 30 * 24 * 3600_000 }))
        .identity,
    );
    // The attacker starts, the victim consents and lands on the page with the token.
    const state = (await start(as)).searchParams.get('state')!;
    const token = finishOf(await callback(t, { code: 'auth-code', state }));
    expect(await finish(victim, token)).toEqual({ ok: false, error: 'account_mismatch' });
    expect(await pendings(t)).toEqual([]);
    // Burnt for everyone, the attacker included.
    expect(await finish(as, token)).toEqual({ ok: false, error: 'invalid_finish' });
    expect(await accounts(t)).toEqual([]);
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(requests.at(-1)).toEqual({
      url: 'https://oauth2.googleapis.com/revoke',
      form: { token: 'refresh-1' },
    });
    await expect(finish(t as unknown as As, token)).rejects.toThrow();
  });

  test('a finish token is good once and for five minutes; an unclaimed grant is swept and revoked', async () => {
    const { t, as } = await setup();
    const first = finishOf(
      await callback(t, { code: 'c', state: (await start(as)).searchParams.get('state')! }),
    );
    expect(await finish(as, first)).toEqual({ ok: true, provider: 'google' });
    expect(await finish(as, first)).toEqual({ ok: false, error: 'invalid_finish' });
    expect(await finish(as, 'never-issued')).toEqual({ ok: false, error: 'invalid_finish' });
    const late = finishOf(
      await callback(t, { code: 'c', state: (await start(as)).searchParams.get('state')! }),
    );
    jest.setSystemTime(new Date(Date.now() + 5 * 60_000 + 1));
    expect(await finish(as, late)).toEqual({ ok: false, error: 'invalid_finish' });
    expect(await pendings(t)).toEqual([]);
    // Nobody came back for this one: the next callback sweeps it.
    await callback(t, { code: 'c', state: (await start(as)).searchParams.get('state')! });
    jest.setSystemTime(new Date(Date.now() + 5 * 60_000 + 1));
    await callback(t, { code: 'c', state: (await start(as)).searchParams.get('state')! });
    expect(await pendings(t)).toHaveLength(1);
    requests.length = 0;
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(requests.filter((r) => r.url.endsWith('/revoke'))).toHaveLength(2);
    expect(await accounts(t)).toHaveLength(1);
  });

  test('a callback that fails unexpectedly still lands on the page', async () => {
    const { t, as } = await setup();
    const state = (await start(as)).searchParams.get('state')!;
    const mocked = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const error = console.error;
    console.error = () => {};
    const response = await callback(t, { code: 'c', state });
    console.error = error;
    globalThis.fetch = mocked;
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(
      'https://crm.example.com/settings/integrations?error=internal',
    );
  });

  test('starting a connection never touches the client secret', async () => {
    const { as } = await setup();
    // Without the key the stored secret cannot be decrypted: the consent URL needs only the client id.
    delete process.env.SECRETS_KEY;
    expect((await start(as)).searchParams.get('client_id')).toBe('own-google-id');
  });

  test('a replayed, expired, forged or foreign callback is refused and exchanges nothing', async () => {
    const { t, as } = await setup();
    const state = (await start(as)).searchParams.get('state')!;
    await connect(t, as, state);
    expect(requests).toHaveLength(1);
    const location = async (query: Record<string, string>) =>
      (await callback(t, query)).headers.get('Location');
    const refused = 'https://crm.example.com/settings/integrations?error=invalid_state';
    // Replayed: the state was consumed by the first callback.
    expect(await location({ code: 'auth-code', state })).toBe(refused);
    // Expired in the signature.
    const old = await signState({
      t: '',
      p: 'google',
      n: 'n',
      e: Math.floor(Date.now() / 1000) - 1,
    });
    expect(await location({ code: 'c', state: old })).toBe(refused);
    // Signed here, but no connection in progress carries that nonce.
    const orphan = await signState({
      t: '',
      p: 'google',
      n: 'never-issued',
      e: Math.floor(Date.now() / 1000) + 60,
    });
    expect(await location({ code: 'c', state: orphan })).toBe(refused);
    // Issued for one provider, presented for another.
    const second = (await start(as)).searchParams.get('state')!;
    const [body] = second.split('.') as [string];
    const swapped = JSON.parse(Buffer.from(body, 'base64url').toString());
    const asMicrosoft = await signState({ ...swapped, p: 'microsoft' });
    expect(await location({ code: 'c', state: asMicrosoft })).toBe(refused);
    expect(await location({ code: 'c', state: 'garbage' })).toBe(refused);
    // The row expired before the user came back.
    const third = (await start(as)).searchParams.get('state')!;
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('connectorStates').collect()) {
        await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
      }
    });
    expect(await location({ code: 'c', state: third })).toBe(refused);
    // The user said no at the provider.
    expect(await location({ error: 'access_denied', state: third })).toBe(
      'https://crm.example.com/settings/integrations?error=access_denied',
    );
    expect(requests).toHaveLength(1);
    expect(await accounts(t)).toHaveLength(1);
  });

  test('a grant without a refresh token, or a failed exchange, stores nothing', async () => {
    const { t, as } = await setup();
    const location = async () => {
      const state = (await start(as)).searchParams.get('state')!;
      return (await callback(t, { code: 'c', state })).headers.get('Location');
    };
    const { refresh_token: _none, ...withoutRefresh } = GRANT;
    tokenAnswer = { status: 200, body: withoutRefresh };
    expect(await location()).toMatch(/error=no_refresh_token$/);
    tokenAnswer = { status: 400, body: { error: 'invalid_grant' } };
    expect(await location()).toMatch(/error=invalid_grant$/);
    tokenAnswer = { status: 500, body: {} };
    expect(await location()).toMatch(/error=http_500$/);
    expect(await accounts(t)).toEqual([]);
  });

  test('with a callback dispatcher the redirect goes through it, in the consent URL and in the exchange alike', async () => {
    process.env.OAUTH_CALLBACK_BASE = 'https://auth.fabulous-crm.test/';
    process.env.OAUTH_CALLBACK_TENANT = 'acme';
    process.env.OAUTH_STATE_SECRET = 'shared-with-the-dispatcher';
    const { t, as } = await setup();
    const url = await start(as);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://auth.fabulous-crm.test/oauth/callback',
    );
    const state = url.searchParams.get('state')!;
    // The dispatcher routes on `t` and validates with the shared key; it never sees the verifier.
    expect((await verifyState(state))!.t).toBe('acme');
    expect(Buffer.from(state.split('.')[0]!, 'base64url').toString()).not.toContain('codeVerifier');
    // The dispatcher forwards the browser here with the same code and state.
    const response = await callback(t, { code: 'auth-code', state });
    expect(response.headers.get('Location')).toMatch(/\?finish=[\w-]+$/);
    expect(requests[0]!.form.redirect_uri).toBe('https://auth.fabulous-crm.test/oauth/callback');
  });

  test('credentials: the deployment own app first, the environment as the managed fallback, nothing otherwise', async () => {
    const { t, as } = await setup();
    const sourceOf = async (provider: string) =>
      (await as.query(api.features.connectors.queries.overview, {})).find(
        (p) => p.provider === provider,
      )!.source;
    expect(await sourceOf('google')).toBe('own');
    expect(await sourceOf('microsoft')).toBeNull();
    await expect(start(as, 'microsoft')).rejects.toThrow(/connector_not_configured/);
    process.env.CONNECTOR_MICROSOFT_CLIENT_ID = 'managed-ms-id';
    process.env.CONNECTOR_MICROSOFT_CLIENT_SECRET = 'managed-ms-secret';
    expect(await sourceOf('microsoft')).toBe('managed');
    const url = await start(as, 'microsoft');
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('managed-ms-id');
    expect(url.searchParams.get('scope')).toBe('openid email profile offline_access');
    tokenAnswer = {
      status: 200,
      body: {
        ...GRANT,
        // `sub` changes with the app registration, `oid` does not.
        id_token: idToken({
          sub: 'pairwise-sub',
          oid: 'ms-oid-1',
          preferred_username: 'ada@corp.example',
        }),
      },
    };
    await connect(t, as, url.searchParams.get('state')!, 'c');
    expect(requests.at(-1)!.form.client_secret).toBe('managed-ms-secret');
    expect((await accounts(t)).find((a) => a.provider === 'microsoft')).toMatchObject({
      providerAccountId: 'ms-oid-1',
      email: 'ada@corp.example',
    });
    // The deployment's own app, once disabled, gives way to the managed one.
    process.env.CONNECTOR_GOOGLE_CLIENT_ID = 'managed-google-id';
    process.env.CONNECTOR_GOOGLE_CLIENT_SECRET = 'managed-google-secret';
    expect(await sourceOf('google')).toBe('own');
    await as.mutation(api.features.config.mutations.updateConfig, {
      connectors: [{ provider: 'google', clientId: 'own-google-id', enabled: false }],
    });
    expect(await sourceOf('google')).toBe('managed');
  });
});

describe('tokens', () => {
  async function connected() {
    const ctx = await setup();
    const state = (await start(ctx.as)).searchParams.get('state')!;
    await connect(ctx.t, ctx.as, state, 'c');
    const [account] = await accounts(ctx.t);
    requests.length = 0;
    return { ...ctx, accountId: account!._id as Id<'connectorAccounts'> };
  }
  const tokenOf = (t: T, accountId: Id<'connectorAccounts'>) =>
    t.action(internal.features.connectors.actions.accessToken, { accountId });

  test('a fresh access token is served as is; an expiring one is refreshed and stored as ciphertext', async () => {
    const { t, accountId } = await connected();
    expect(await tokenOf(t, accountId)).toBe('access-1');
    expect(requests).toEqual([]);
    jest.setSystemTime(new Date(Date.now() + 3600_000 - 30_000));
    tokenAnswer = {
      status: 200,
      body: { access_token: 'access-2', expires_in: 3600, refresh_token: 'refresh-2' },
    };
    expect(await tokenOf(t, accountId)).toBe('access-2');
    expect(requests).toEqual([
      {
        url: 'https://oauth2.googleapis.com/token',
        form: {
          grant_type: 'refresh_token',
          refresh_token: 'refresh-1',
          client_id: 'own-google-id',
          client_secret: 'own-google-secret',
        },
      },
    ]);
    const [account] = await accounts(t);
    expect(account!.accessToken).toMatch(/^v1:/);
    // A rotated refresh token replaces the old one.
    jest.setSystemTime(new Date(Date.now() + 2 * 3600_000));
    await tokenOf(t, accountId);
    expect(requests.at(-1)!.form.refresh_token).toBe('refresh-2');
  });

  test('a refused refresh token marks the account for reconnection; a transient failure does not', async () => {
    const { t, as, accountId } = await connected();
    jest.setSystemTime(new Date(Date.now() + 2 * 3600_000));
    tokenAnswer = { status: 503, body: {} };
    expect(await tokenOf(t, accountId)).toBeNull();
    expect((await accounts(t))[0]!.status).toBe('active');
    tokenAnswer = { status: 400, body: { error: 'invalid_grant' } };
    expect(await tokenOf(t, accountId)).toBeNull();
    expect((await accounts(t))[0]).toMatchObject({ status: 'error', lastError: 'invalid_grant' });
    expect((await accounts(t))[0]!.accessToken).toBeUndefined();
    const overview = await as.query(api.features.connectors.queries.overview, {});
    expect(overview.find((p) => p.provider === 'google')!.account!.status).toBe('error');
    // No further call to the provider until the user reconnects.
    requests.length = 0;
    expect(await tokenOf(t, accountId)).toBeNull();
    expect(requests).toEqual([]);
  });

  test('disconnecting hides the account at once, revokes the grant at the provider and clears the row', async () => {
    const { t, as, accountId } = await connected();
    await as.mutation(api.features.connectors.mutations.disconnect, { provider: 'google' });
    const overview = await as.query(api.features.connectors.queries.overview, {});
    expect(overview.find((p) => p.provider === 'google')!.account).toBeNull();
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(requests).toEqual([
      { url: 'https://oauth2.googleapis.com/revoke', form: { token: 'refresh-1' } },
    ]);
    expect(await accounts(t)).toEqual([]);
    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter((a) => a.entityId === accountId),
    );
    expect(audits.map((a) => a.action)).toEqual(['create', 'delete']);
    expect(audits[1]!.metadata).toMatchObject({ provider: 'google', revokedAtProvider: true });
    expect(JSON.stringify(audits)).not.toContain('refresh-1');
    await expect(
      as.mutation(api.features.connectors.mutations.disconnect, { provider: 'google' }),
    ).rejects.toThrow(/connector_account_not_found/);
  });

  test('reconnecting before the revocation ran keeps the fresh grant: nothing is revoked nor removed', async () => {
    const { t, as, accountId } = await connected();
    await as.mutation(api.features.connectors.mutations.disconnect, { provider: 'google' });
    tokenAnswer = { status: 200, body: { ...GRANT, refresh_token: 'refresh-new' } };
    await connect(t, as, (await start(as)).searchParams.get('state')!);
    requests.length = 0;
    await t.finishAllScheduledFunctions(() => jest.runAllTimers());
    expect(requests).toEqual([]);
    expect(await accounts(t)).toMatchObject([{ _id: accountId, status: 'active' }]);
    // The revocation had already read the old token when the user reconnected: the row stays all the same.
    await as.mutation(api.features.connectors.mutations.disconnect, { provider: 'google' });
    await t.run((ctx) => ctx.db.patch(accountId, { status: 'active' }));
    await t.mutation(internal.features.connectors.internal.removeAccount, {
      accountId,
      revoked: true,
    });
    expect(await accounts(t)).toHaveLength(1);
  });
});

describe('connector settings', () => {
  test('the OAuth app secret is stored as ciphertext, kept when omitted, never returned; an enabled app needs both', async () => {
    const { t, as } = await setup();
    const stored = async () =>
      (await t.run((ctx) => ctx.db.query('appConfig').first()))!.connectors!;
    const secret = (await stored())[0]!.clientSecret;
    expect(secret).toMatch(/^v1:/);
    await as.mutation(api.features.config.mutations.updateConfig, {
      connectors: [{ provider: 'google', clientId: 'renamed-id', enabled: true }],
    });
    expect((await stored())[0]).toMatchObject({ clientId: 'renamed-id', clientSecret: secret });
    const admin = await as.query(api.features.config.queries.getAdminConfig, {});
    expect(admin!.connectors).toEqual([
      {
        provider: 'google',
        label: 'Google',
        clientId: 'renamed-id',
        hasClientSecret: true,
        enabled: true,
        source: 'own',
        redirectUri: 'https://crm-123.convex.site/connectors/callback',
      },
      {
        provider: 'microsoft',
        label: 'Microsoft',
        clientId: '',
        hasClientSecret: false,
        enabled: false,
        source: null,
        redirectUri: 'https://crm-123.convex.site/connectors/callback',
      },
    ]);
    expect(JSON.stringify(admin)).not.toContain('own-google-secret');
    await expect(
      as.mutation(api.features.config.mutations.updateConfig, {
        connectors: [{ provider: 'microsoft', clientId: 'ms-id', enabled: true }],
      }),
    ).rejects.toThrow(/connector_credentials_required/);
  });
});
