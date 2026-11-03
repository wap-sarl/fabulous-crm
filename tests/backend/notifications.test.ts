import { beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { WorkflowNode } from '../../convex/_lib/validators/workflows';
import { logAudit } from '../../convex/lib/audit/log';
import { emitEvent } from '../../convex/lib/notifications/emit';
import { fanOutEvent } from '../../convex/lib/notifications/fanOut';
import { logStep } from '../../convex/lib/workflows/runs';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runDue,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 10, 2, 9, 0, 0);
beforeEach(() => pinClock(NOW));

// Running the scheduled work lands the fake clock on the real time: the sessions must outlive that.
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/** Lou (admin) acts; Camille (member, sees her own records) and Sam (manager, sees his team's) are told. */
async function setup() {
  const t = createTestConvex();
  const lou = await seedEmployee(t, {
    email: 'lou@example.com',
    role: 'admin',
    firstName: 'Lou',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const camille = await seedEmployee(t, {
    email: 'camille@example.com',
    role: 'member',
    firstName: 'Camille',
    lastName: 'Roux',
    sessionTtlMs: SESSION_TTL_MS,
  });
  const sam = await seedEmployee(t, {
    email: 'sam@example.com',
    role: 'manager',
    firstName: 'Sam',
    sessionTtlMs: SESSION_TTL_MS,
  });
  return { t, lou, camille, sam, asLou: asIdentity(t, lou.identity) };
}

const events = (t: T) => t.run((ctx) => ctx.db.query('notificationEvents').collect());
const inboxOf = (t: T, userId: Id<'users'>) =>
  t.run((ctx) =>
    ctx.db
      .query('notifications')
      .withIndex('by_user_created', (q) => q.eq('userId', userId))
      .collect(),
  );

describe('the producer', () => {
  test('assigning a lead writes one fact in the transaction and schedules the fan-out once; the new owner is told, the actor is not', async () => {
    const { t, lou, camille, sam, asLou } = await setup();
    const leadId = await asLou.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Jean',
      lastName: 'Dupont',
      ownerIds: [lou.userId],
    });
    // The creator owning their own lead: nobody to tell, so not even a fact.
    expect(await events(t)).toEqual([]);

    await asLou.mutation(api.features.leads.mutations.updateLead, {
      leadId,
      ownerIds: [lou.userId, camille.userId, sam.userId],
    });
    const pending = await events(t);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: 'lead.assigned',
      entity: { type: 'lead', id: leadId },
      actorId: lou.userId,
      data: { assigned: [camille.userId, sam.userId] },
    });
    const scheduled = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    expect(
      scheduled.filter(
        (j) => j.name === 'features/notifications/internal:fanOut' && j.state.kind === 'pending',
      ),
    ).toHaveLength(1);

    await runDue(t);
    expect(await events(t)).toEqual([]);
    const camilleInbox = await inboxOf(t, camille.userId);
    expect(camilleInbox).toHaveLength(1);
    expect(camilleInbox[0]).toMatchObject({
      kind: 'lead.assigned',
      title: 'Lead attribué : Jean Dupont',
      body: 'Lou User vous a attribué le lead Jean Dupont.',
      path: `/leads/${leadId}`,
      dedupeKey: `lead.assigned:${leadId}:${camille.userId}`,
      // The row carries the fact's time, not the fan-out's.
      createdAt: pending[0]!.at,
    });
    expect(camilleInbox[0]!.readAt).toBeUndefined();
    expect(await inboxOf(t, sam.userId)).toHaveLength(1);
    expect(await inboxOf(t, lou.userId)).toEqual([]);
  });

  test('an import produces no assignment facts, whatever it writes', async () => {
    const { t, lou, camille } = await setup();
    // What the importer writes: an audited update with the import's signature.
    const leadId = await seedLead(t, { email: 'imported@example.com' });
    await t.run(async (ctx) => {
      await logAudit({
        ctx,
        userId: lou.userId,
        entityType: 'lead',
        entityId: leadId,
        action: 'update',
        metadata: { changes: { ownerIds: { old: [], new: [camille.userId] } }, source: 'import' },
      });
    });
    expect(await events(t)).toEqual([]);
  });

  test('a deal: assigned at creation, then its stage change tells the owner and its closing tells the teammates who may see it', async () => {
    const { t, camille, sam, asLou } = await setup();
    // Alex is in the team too, but a member sees their own deals only: the inbox must not show them Camille's.
    const alex = await seedEmployee(t, {
      email: 'alex@example.com',
      role: 'member',
      sessionTtlMs: SESSION_TTL_MS,
    });
    await asLou.mutation(api.features.teams.mutations.createTeam, {
      name: 'Ventes',
      memberIds: [camille.userId, sam.userId, alex.userId],
    });
    const pipelineId = await asLou.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
    const dealId = await asLou.mutation(api.features.deals.mutations.createDeal, {
      title: 'Clinique Nord',
      pipelineId,
      ownerIds: [camille.userId],
    });
    await runDue(t);
    expect((await inboxOf(t, camille.userId)).map((n) => n.kind)).toEqual(['deal.assigned']);
    expect(await inboxOf(t, sam.userId)).toEqual([]);

    await asLou.mutation(api.features.deals.mutations.moveDealStage, {
      dealId,
      stageKey: 'qualified',
    });
    await runDue(t);
    const moved = await inboxOf(t, camille.userId);
    expect(moved.map((n) => n.kind)).toEqual(['deal.assigned', 'deal.stage_changed']);
    expect(moved[1]).toMatchObject({
      title: 'Clinique Nord : Qualifiée',
      body: 'Lou User a déplacé la transaction au stade « Qualifiée ».',
    });
    expect(await inboxOf(t, sam.userId)).toEqual([]);

    // Camille reads her inbox: what follows is not coalesced with it.
    const read = await inboxOf(t, camille.userId);
    await t.run(async (ctx) => {
      for (const row of read) await ctx.db.patch(row._id, { readAt: NOW });
    });
    // Won, reopened, then lost before the fan-out runs: each fact keeps what its move did.
    for (const stageKey of ['proposal', 'negotiation', 'won', 'negotiation', 'lost']) {
      await asLou.mutation(api.features.deals.mutations.moveDealStage, { dealId, stageKey });
    }
    // The facts carry the won, then the lost, whatever the deal shows now.
    const closings = (await events(t)).filter((e) => e.kind === 'deal.closed');
    expect(closings.map((e) => e.data?.status)).toEqual(['won', 'lost']);
    await runDue(t);
    // Two closings while the first is unread: one row, refreshed with the latest.
    const samRows = await inboxOf(t, sam.userId);
    expect(samRows.map((n) => n.kind)).toEqual(['deal.closed']);
    expect(samRows[0]).toMatchObject({ title: 'Transaction perdue : Clinique Nord' });
    // The stage changes while unread share one row too, which names the last stage, never one the deal left.
    const camilleRows = await inboxOf(t, camille.userId);
    expect(camilleRows.map((n) => n.kind)).toEqual([
      'deal.assigned',
      'deal.stage_changed',
      'deal.stage_changed',
      'deal.closed',
    ]);
    expect(camilleRows[2]).toMatchObject({ title: 'Clinique Nord : Négociation' });
    expect(await inboxOf(t, alex.userId)).toEqual([]);
  });

  test('a task handed to someone tells them, at creation and when it changes hands', async () => {
    const { t, lou, camille, sam, asLou } = await setup();
    const activityId = await asLou.mutation(api.features.activities.mutations.createActivity, {
      type: 'task',
      title: 'Rappeler le cabinet',
      ownerId: camille.userId,
    });
    await runDue(t);
    expect((await inboxOf(t, camille.userId))[0]).toMatchObject({
      kind: 'activity.assigned',
      title: 'Tâche attribuée : Rappeler le cabinet',
      path: '/tasks',
    });
    await asLou.mutation(api.features.activities.mutations.updateActivity, {
      activityId,
      ownerId: sam.userId,
    });
    await runDue(t);
    expect((await inboxOf(t, sam.userId)).map((n) => n.kind)).toEqual(['activity.assigned']);
    expect(await inboxOf(t, lou.userId)).toEqual([]);
  });

  test('a failed workflow step tells the settings right, once per run while unread', async () => {
    const { t, lou, camille, asLou } = await setup();
    const leadId = await asLou.mutation(api.features.leads.mutations.createLead, {
      firstName: 'A',
      lastName: 'B',
    });
    await t.run(async (ctx) => {
      const workflowId = await ctx.db.insert('workflows', {
        name: 'Relance',
        status: 'active',
        trigger: { type: 'lead_created' },
        allowReEnrollment: false,
        nodes: [],
        enrolledCount: 1,
        activeCount: 1,
        completedCount: 0,
        updatedAt: NOW,
      });
      const runId = await ctx.db.insert('workflowRuns', {
        workflowId,
        leadId,
        status: 'active',
        triggerType: 'lead_created',
        enrolledAt: NOW,
        currentNodeId: 'n1',
        stepCount: 0,
      });
      const run = (await ctx.db.get(runId))!;
      const node = { id: 'n1', type: 'send_email' } as unknown as WorkflowNode;
      await logStep(ctx, run, node, 'failed', { detail: 'Brevo 500' });
      await logStep(ctx, run, node, 'failed', { detail: 'Brevo 500' });
    });
    await runDue(t);
    const louInbox = await inboxOf(t, lou.userId);
    expect(louInbox).toHaveLength(1);
    expect(louInbox[0]).toMatchObject({
      kind: 'workflow.run_failed',
      title: 'Échec du workflow « Relance »',
      body: 'Une étape a échoué : Brevo 500.',
    });
    // A member without the settings right is not told.
    expect(await inboxOf(t, camille.userId)).toEqual([]);
  });

  test('the same fact twice refreshes the unread row instead of adding one, and rings again once it was read', async () => {
    const { t, lou, camille } = await setup();
    const leadId = await seedLead(t, { email: 'twice@example.com' });
    const fact = {
      kind: 'lead.assigned' as const,
      entity: { type: 'lead' as const, id: leadId },
      actorId: lou.userId,
      data: { assigned: [camille.userId] },
    };
    await t.run((ctx) => emitEvent(ctx, fact));
    await t.run((ctx) => emitEvent(ctx, fact));
    await runDue(t);
    const once = await inboxOf(t, camille.userId);
    expect(once).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(once[0]!._id, { readAt: NOW }));
    await t.run((ctx) => emitEvent(ctx, fact));
    await runDue(t);
    expect(await inboxOf(t, camille.userId)).toHaveLength(2);
  });

  test('a fact about a record that is gone, or for a deleted person, writes nothing', async () => {
    const { t, lou, camille } = await setup();
    const left = await seedEmployee(t, { email: 'left@example.com', deletedAt: NOW - 1 });
    const leadId = await seedLead(t, { email: 'gone@example.com' });
    const stale = await t.run(async (ctx) => {
      await emitEvent(ctx, {
        kind: 'lead.assigned',
        entity: { type: 'lead', id: leadId },
        actorId: lou.userId,
        data: { assigned: [camille.userId, left.userId] },
      });
      return (await ctx.db.query('notificationEvents').first())!;
    });
    expect(await t.run((ctx) => fanOutEvent(ctx, stale))).toBe(1);
    expect(await inboxOf(t, left.userId)).toEqual([]);
    await t.run((ctx) => ctx.db.delete(leadId));
    expect(await t.run((ctx) => fanOutEvent(ctx, stale))).toBe(0);
  });

  test('a run drains fifty facts and schedules the next for the rest', async () => {
    const { t, lou, camille } = await setup();
    const leadId = await seedLead(t, { email: 'many@example.com' });
    await t.run(async (ctx) => {
      for (let i = 0; i < 51; i++) {
        await emitEvent(ctx, {
          kind: 'lead.assigned',
          entity: { type: 'lead', id: leadId },
          actorId: lou.userId,
          data: { assigned: [camille.userId] },
        });
      }
    });
    await t.mutation(internal.features.notifications.internal.fanOut, {});
    expect(await events(t)).toHaveLength(1);
    await runDue(t);
    expect(await events(t)).toEqual([]);
  });
});
