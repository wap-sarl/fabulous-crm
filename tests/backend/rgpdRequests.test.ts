import { expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import { asIdentity, createTestConvex, pinClock, seedEmployee, seedLead } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);

test('the requests of a contact are listed newest first, one still running and one whose author is gone included', async () => {
  const t = createTestConvex();
  pinClock(NOW);
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const gone = await seedEmployee(t, { email: 'gone@example.com', role: 'admin' });
  const leadId = await seedLead(t, { email: 'ada@example.com' });
  const [done, running] = await t.run(async (ctx) => {
    const first = await ctx.db.insert('rgpdRequests', {
      type: 'access',
      leadId,
      requestedBy: admin.userId,
      requestedAt: NOW - 2000,
      completedAt: NOW - 1000,
      outcome: 'done',
    });
    const second = await ctx.db.insert('rgpdRequests', {
      type: 'erasure',
      leadId,
      requestedBy: gone.userId,
      requestedAt: NOW - 500,
      outcome: 'in_progress',
    });
    await ctx.db.insert('rgpdRequests', {
      type: 'access',
      leadId: 'another-contact',
      requestedBy: admin.userId,
      requestedAt: NOW,
      outcome: 'done',
    });
    await ctx.db.delete(gone.userId);
    return [first, second];
  });

  const requests = await asIdentity(t, admin.identity).query(
    api.features.rgpd.queries.listRequests,
    { leadId },
  );
  expect(requests).toEqual([
    {
      _id: running,
      type: 'erasure',
      requestedAt: NOW - 500,
      completedAt: null,
      outcome: 'in_progress',
      requestedBy: null,
    },
    {
      _id: done,
      type: 'access',
      requestedAt: NOW - 2000,
      completedAt: NOW - 1000,
      outcome: 'done',
      requestedBy: expect.any(String),
    },
  ]);
});
