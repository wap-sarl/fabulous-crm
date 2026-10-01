import { describe, expect, test } from 'bun:test';
import { internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { createKey } from './apiClient';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'ada@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const { id: apiKeyId } = await createKey(as, ['contacts:write']);
  return { t, apiKeyId };
}

const REQUEST = { key: 'zap-run-42', fingerprint: 'a'.repeat(64) };

/** What the HTTP action does before running a POST that carries an Idempotency-Key. */
const begin = (t: T, apiKeyId: Id<'apiKeys'>, request = REQUEST) =>
  t.mutation(internal.features.api.internal.beginIdempotentRequest, { apiKeyId, ...request });

/** A fresh reservation: the test fails if the key is already taken. */
async function reserve(t: T, apiKeyId: Id<'apiKeys'>, request = REQUEST) {
  const reservation = await begin(t, apiKeyId, request);
  if (reservation.kind !== 'new')
    throw new Error(`expected a new reservation: ${reservation.kind}`);
  return reservation.id;
}

const abandon = (t: T, id: Id<'apiIdempotencyKeys'>) =>
  t.mutation(internal.features.api.internal.abandonIdempotentRequest, { id });

const reservations = (t: T) => t.run((ctx) => ctx.db.query('apiIdempotencyKeys').collect());

describe('abandoned idempotent request', () => {
  test('abandoning a pending reservation removes it, so the retry runs again', async () => {
    const { t, apiKeyId } = await setup();
    const id = await reserve(t, apiKeyId);
    // While the first request runs, the same key is refused as in progress.
    expect(await begin(t, apiKeyId)).toEqual({ kind: 'pending' });

    expect(await abandon(t, id)).toBeNull();

    expect(await reservations(t)).toEqual([]);
    const retry = await begin(t, apiKeyId);
    expect(retry.kind).toBe('new');
    expect(retry.kind === 'new' && retry.id).not.toBe(id);
  });

  test('abandoning leaves the other reservations alone', async () => {
    const { t, apiKeyId } = await setup();
    const failed = await reserve(t, apiKeyId);
    const other = await reserve(t, apiKeyId, { key: 'zap-run-43', fingerprint: 'b'.repeat(64) });
    await t.mutation(internal.features.api.internal.finishIdempotentRequest, {
      id: other,
      status: 201,
      body: '{"id":"contact-1"}',
    });

    expect(await abandon(t, failed)).toBeNull();

    expect((await reservations(t)).map((row) => row._id)).toEqual([other]);
    expect(await begin(t, apiKeyId, { key: 'zap-run-43', fingerprint: 'b'.repeat(64) })).toEqual({
      kind: 'replay',
      status: 201,
      body: '{"id":"contact-1"}',
    });
  });

  test('abandoning a reservation that is already gone is a no-op', async () => {
    const { t, apiKeyId } = await setup();
    const id = await reserve(t, apiKeyId);
    expect(await abandon(t, id)).toBeNull();
    expect(await abandon(t, id)).toBeNull();
    expect(await reservations(t)).toEqual([]);
  });
});
