import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConvexError, type Value } from 'convex/values';
import { api } from '../../convex/_generated/api';
import { refusal, refusalFrom, refusalOf, refusalText } from '../../convex/_lib/refusal';
import {
  boundedInt,
  countryCodeSchema,
  currencyCodeSchema,
  emailSchema,
  follows,
  hexColorSchema,
  httpUrlSchema,
} from '../../convex/_lib/validators/fields';
import { toApiError } from '../../convex/lib/api/errors';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

describe('a refusal', () => {
  test('carries its code and what was given with it, nothing undefined', () => {
    expect(refusal('lead_not_found').data).toEqual({ code: 'lead_not_found' });
    expect(refusal('invalid_deal', { reason: 'amount', message: undefined }).data).toStrictEqual({
      code: 'invalid_deal',
      reason: 'amount',
    });
    expect(refusal('list_name_required', { message: 'Le nom est requis.' })).toBeInstanceOf(
      ConvexError,
    );
  });

  test('is read back from a refusal, and from the text of a plain error that spells a code', () => {
    expect(refusalOf(refusal('invalid_deal', { reason: 'amount' }))).toEqual({
      code: 'invalid_deal',
      reason: 'amount',
    });
    expect(refusalOf(refusal('lead_not_found'))).toEqual({ code: 'lead_not_found' });
    expect(refusalOf(new Error('lead_not_found'))).toEqual({ code: 'lead_not_found' });
    expect(refusalOf(new Error('invalid_address: État : requis'))).toEqual({
      code: 'invalid_address',
      reason: 'État : requis',
    });
    for (const other of [new Error('Config not initialized'), new ConvexError('text'), 'x', null]) {
      expect(refusalOf(other)).toBeNull();
    }
  });

  test('is stored and logged as `code` or `code: reason`; anything else as its message', () => {
    expect(refusalText(refusal('lead_not_found'), 'x')).toBe('lead_not_found');
    expect(refusalText(refusal('invalid_deal', { reason: 'amount' }), 'x')).toBe(
      'invalid_deal: amount',
    );
    expect(refusalText(new Error('Connection reset'), 'x')).toBe('Connection reset');
    expect(refusalText('boom', 'unknown')).toBe('unknown');
  });

  test('is made from the text a validator returns: a code as it is, a sentence as its message', () => {
    expect(refusalFrom('pipeline_invalid_key', 'invalid_pipeline').data).toEqual({
      code: 'pipeline_invalid_key',
    });
    expect(refusalFrom('invalid_deal: amount', 'invalid_pipeline').data).toEqual({
      code: 'invalid_deal',
      reason: 'amount',
    });
    expect(
      refusalFrom('Un workflow est limité à 50 étapes.', 'workflow_graph_invalid').data,
    ).toEqual({ code: 'workflow_graph_invalid', message: 'Un workflow est limité à 50 étapes.' });
  });

  test('reaches the caller of a mutation with its code, its reason and its sentence', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'agent@example.com' });
    const as = asIdentity(t, emp.identity);
    const leadId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'A',
      lastName: 'B',
    });
    await as.mutation(api.features.leads.mutations.deleteLead, { leadId });
    await expect(
      as.mutation(api.features.leads.mutations.deleteLead, { leadId }),
    ).rejects.toMatchObject({ data: { code: 'lead_not_found' } });
    await expect(
      as.mutation(api.features.deals.mutations.createDeal, { title: 'x', amount: -1 }),
    ).rejects.toMatchObject({ data: { code: 'invalid_deal', reason: 'amount' } });
    await expect(
      as.mutation(api.features.leadLists.mutations.createLeadList, { name: ' ' }),
    ).rejects.toMatchObject({
      data: { code: 'list_name_required', message: 'Le nom de la liste est requis.' },
    });
  });

  test('becomes the same API error whether it was thrown as a refusal or as a text', () => {
    const shape = (error: unknown) => (toApiError(error) as ConvexError<Value>).data;
    for (const error of [
      refusal('invalid_deal', { reason: 'amount' }),
      new Error('invalid_deal: amount'),
    ]) {
      expect(shape(error)).toEqual({
        status: 400,
        code: 'invalid_deal',
        message: 'invalid_deal: amount',
        details: { reason: 'amount' },
      });
    }
    expect(shape(refusal('deal_transition_forbidden'))).toEqual({
      status: 409,
      code: 'deal_transition_forbidden',
      message: 'deal_transition_forbidden',
    });
    const bug = new Error('Config not initialized');
    expect(toApiError(bug)).toBe(bug);
  });
});

/** The files that may throw a code as a plain error: what they throw is for the operator, not for the person. */
const PLAIN_CODES_ALLOWED = ['lib/security/crypto.ts'];

function sourcesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '_generated' ? [] : sourcesOf(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('the backend throws a code as a refusal, never as a plain error the client would not receive', () => {
  const root = join(import.meta.dir, '../../convex');
  const plain = sourcesOf(root)
    .filter((path) => !PLAIN_CODES_ALLOWED.some((allowed) => path.endsWith(allowed)))
    .flatMap((path) =>
      [
        ...readFileSync(path, 'utf8').matchAll(/throw new Error\((['`])([a-z][a-z0-9_]*)[:'`]/g),
      ].map((match) => `${path.slice(root.length + 1)}: ${match[2]}`),
    );
  expect(plain).toEqual([]);
});

describe('the rules of the shared fields', () => {
  const cases: [string, Parameters<typeof follows>[0], unknown[], unknown[]][] = [
    [
      'an e-mail address',
      emailSchema,
      ['a@b.fr', 'prénom.nom@société.example'],
      ['a@b', 'a b@c.fr', '@b.fr', '', 12],
    ],
    [
      'an http address',
      httpUrlSchema,
      ['https://x', 'http://a.b/c?d'],
      ['ftp://x', 'x.fr', ' https://x', 'https://', ''],
    ],
    [
      'a colour',
      hexColorSchema,
      ['#aabbcc', '#AABBCC', '#012345'],
      ['#abc', 'aabbcc', '#aabbccd', '#gggggg'],
    ],
    ['a country', countryCodeSchema, ['FR', 'US'], ['fr', 'FRA', 'F', '']],
    ['a currency', currencyCodeSchema, ['EUR', 'USD'], ['eur', 'EU', 'EURO']],
    ['a bounded whole number', boundedInt(1, 10), [1, 5, 10], [0, 11, 2.5, Number.NaN, '5']],
  ];
  for (const [name, schema, accepted, refused] of cases) {
    test(name, () => {
      for (const value of accepted) expect(follows(schema, value)).toBe(true);
      for (const value of refused) expect(follows(schema, value)).toBe(false);
    });
  }
});
