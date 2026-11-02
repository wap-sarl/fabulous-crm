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

/** The mutations whose fan-out is already scheduled: one scheduler call per transaction, however many facts it emits. */
const scheduled = new WeakSet<object>();

/** Writes the fact in the writer's transaction, so a write that rolls back takes its fact with it, and schedules the fan-out once. */
export async function emitEvent(ctx: MutationCtx, fact: NotificationFact): Promise<void> {
  await ctx.db.insert('notificationEvents', { ...fact, at: Date.now() });
  if (scheduled.has(ctx)) return;
  scheduled.add(ctx);
  await ctx.scheduler.runAfter(0, internal.features.notifications.internal.fanOut, {});
}
