import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type {
  NotificationEntity,
  NotificationEventData,
  NotificationKind,
} from '../../_lib/validators/notifications';

/** A fact to tell: the kind, the record, who did it, and what the fan-out cannot read back from the record. */
export interface NotificationFact {
  kind: NotificationKind;
  entity: NotificationEntity;
  actorId?: Id<'users'>;
  data?: NotificationEventData;
}

/** The mutations that already looked after the fan-out: one look per transaction, however many facts it emits. */
const scheduled = new WeakSet<object>();

/** Writes the fact in the writer's transaction, so a write that rolls back takes its fact with it, and makes sure one fan-out run is pending. */
export async function emitEvent(ctx: MutationCtx, fact: NotificationFact): Promise<void> {
  await ctx.db.insert('notificationEvents', { ...fact, at: Date.now() });
  if (scheduled.has(ctx)) return;
  scheduled.add(ctx);
  await ensureFanOut(ctx, 0);
}

/** One pending run at a time: mutations writing facts at once queue one run, not one each that would read and delete the same head of the queue; a run in progress is left alone, it reschedules itself while facts remain. */
export async function ensureFanOut(ctx: MutationCtx, delayMs: number): Promise<void> {
  const state = await ctx.db.query('notificationFanOut').first();
  if (state?.scheduledFnId) {
    const job = await ctx.db.system.get(state.scheduledFnId);
    if (job?.state.kind === 'pending') return;
  }
  const scheduledFnId = await ctx.scheduler.runAfter(
    delayMs,
    internal.features.notifications.internal.fanOut,
    {},
  );
  if (state) await ctx.db.patch(state._id, { scheduledFnId });
  else await ctx.db.insert('notificationFanOut', { scheduledFnId });
}
