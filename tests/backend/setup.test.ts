import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { createTestConvex, pinClock, seedConfig, seedEmployee, type T } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const TOKEN = 'setup-token';

let savedToken: string | undefined;
beforeEach(() => {
  savedToken = process.env.SETUP_TOKEN;
  process.env.SETUP_TOKEN = TOKEN;
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.SETUP_TOKEN;
  else process.env.SETUP_TOKEN = savedToken;
});

function fresh(): T {
  const t = createTestConvex();
  pinClock(NOW);
  return t;
}

/** The wizard, finished. */
const completeSetup = (t: T) =>
  t.mutation(api.setup.mutations.completeSetup, {
    setupToken: TOKEN,
    organizationName: 'Acme',
    appUrl: 'https://crm.acme.example.com',
    senderEmail: 'crm@acme.example.com',
    senderName: 'Acme',
    auth: { magicLinkEnabled: true, ssoProviders: [] },
    admin: { email: 'admin@acme.example.com', firstName: 'Ada', lastName: 'Admin' },
  });

/** The deployments the setup gate tells apart, by what they hold. */
const DEPLOYMENTS: { name: string; complete: boolean; prepare: (t: T) => Promise<unknown> }[] = [
  { name: 'a fresh deployment', complete: false, prepare: async () => {} },
  {
    name: 'a configuration the wizard did not finish, even with an employee',
    complete: false,
    prepare: async (t) => {
      await seedConfig(t);
      await seedEmployee(t, { email: 'agent@example.com' });
    },
  },
  { name: 'the wizard finished', complete: true, prepare: completeSetup },
  {
    name: 'a configuration stamped as set up',
    complete: true,
    prepare: (t) => seedConfig(t, { setupCompletedAt: NOW }),
  },
  {
    name: 'employees and no configuration, as before the wizard existed',
    complete: true,
    prepare: (t) => seedEmployee(t, { email: 'agent@example.com' }),
  },
];

describe('the status of the setup', () => {
  for (const { name, complete, prepare } of DEPLOYMENTS) {
    test(`${name}: ${complete ? 'set up' : 'not set up'}`, async () => {
      const t = fresh();
      await prepare(t);
      expect(await t.query(api.setup.queries.status, {})).toEqual({
        setupComplete: complete,
        setupTokenConfigured: true,
      });
    });
  }

  test('a deployment without a token, or with an empty one, says the wizard cannot proceed', async () => {
    const t = fresh();
    delete process.env.SETUP_TOKEN;
    expect(await t.query(api.setup.queries.status, {})).toEqual({
      setupComplete: false,
      setupTokenConfigured: false,
    });
    process.env.SETUP_TOKEN = '';
    expect(await t.query(api.setup.queries.status, {})).toEqual({
      setupComplete: false,
      setupTokenConfigured: false,
    });
  });
});

describe('the setup token', () => {
  const verify = (t: T, setupToken: string) =>
    t.query(api.setup.queries.verifySetupToken, { setupToken });

  test('the token of the deployment is the only one recognised', async () => {
    const t = fresh();
    expect(await verify(t, TOKEN)).toBe(true);
    expect(await verify(t, 'setup-token ')).toBe(false);
    expect(await verify(t, 'SETUP-TOKEN')).toBe(false);
    expect(await verify(t, '')).toBe(false);
  });

  test('a deployment without a token, or with an empty one, recognises none', async () => {
    const t = fresh();
    delete process.env.SETUP_TOKEN;
    expect(await verify(t, TOKEN)).toBe(false);
    expect(await verify(t, '')).toBe(false);
    process.env.SETUP_TOKEN = '';
    expect(await verify(t, '')).toBe(false);
  });

  for (const { name, complete, prepare } of DEPLOYMENTS) {
    test(`${name}: the token is ${complete ? 'no longer recognised' : 'recognised'}`, async () => {
      const t = fresh();
      await prepare(t);
      expect(await verify(t, TOKEN)).toBe(!complete);
    });
  }
});

describe('the upload URL of the wizard', () => {
  const uploadUrl = (t: T, setupToken: string) =>
    t.mutation(api.setup.mutations.generateSetupUploadUrl, { setupToken });

  test('the token gives a URL to upload to, a new one each time, before any user exists', async () => {
    const t = fresh();
    const first = await uploadUrl(t, TOKEN);
    const second = await uploadUrl(t, TOKEN);
    expect(new URL(first).protocol).toBe('https:');
    expect(new URL(second).protocol).toBe('https:');
    expect(second).not.toBe(first);
    expect(await t.run((ctx) => ctx.db.query('users').first())).toBeNull();
  });

  test('another token is refused', async () => {
    const t = fresh();
    for (const setupToken of ['wrong', '', `${TOKEN} `]) {
      await expect(uploadUrl(t, setupToken)).rejects.toMatchObject({
        data: { code: 'invalid_setup_token' },
      });
    }
  });

  test('a deployment without a token, or with an empty one, refuses every upload', async () => {
    const t = fresh();
    delete process.env.SETUP_TOKEN;
    await expect(uploadUrl(t, TOKEN)).rejects.toMatchObject({
      data: { code: 'setup_token_not_configured' },
    });
    process.env.SETUP_TOKEN = '';
    await expect(uploadUrl(t, '')).rejects.toMatchObject({
      data: { code: 'setup_token_not_configured' },
    });
  });

  for (const { name, complete, prepare } of DEPLOYMENTS) {
    test(`${name}: the upload is ${complete ? 'refused' : 'allowed'}`, async () => {
      const t = fresh();
      await prepare(t);
      if (complete) {
        await expect(uploadUrl(t, TOKEN)).rejects.toMatchObject({
          data: { code: 'setup_already_complete' },
        });
        // The token is checked first: a stale wizard with a wrong one learns nothing about the deployment.
        await expect(uploadUrl(t, 'wrong')).rejects.toMatchObject({
          data: { code: 'invalid_setup_token' },
        });
      } else {
        expect(await uploadUrl(t, TOKEN)).toMatch(/^https:\/\/\S+$/);
      }
    });
  }
});
