import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { RecordChange } from '../extensions/types';
import { emitEvent } from './emit';

// The core's listener on the change stream: the kinds that are a plain consequence of an audited write.

type Change = { old?: unknown; new?: unknown };
type Metadata = { changes?: Record<string, Change>; source?: string; event?: string } & Record<
  string,
  unknown
>;

const metadataOf = (change: RecordChange & { type: 'audit' }): Metadata =>
  change.metadata && typeof change.metadata === 'object' ? (change.metadata as Metadata) : {};

const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The ids a list gained, the actor's own aside: nobody is told of what they did themselves, so no fact is written for it. */
const added = (change: Change | undefined, actorId: string | undefined): string[] => {
  if (!change) return [];
  const before = new Set(ids(change.old));
  return ids(change.new).filter((id) => !before.has(id) && id !== actorId);
};

const notActor = (userIds: string[], actorId: string | undefined): string[] =>
  userIds.filter((id) => id !== actorId);

/** Turns an audited write into zero or one fact, in constant time from the change alone, with one read of the record for the cases that need it; a bulk write (an import) produces nothing. */
export async function observeChange(ctx: MutationCtx, change: RecordChange): Promise<void> {
  if (change.type !== 'audit') return;
  const metadata = metadataOf(change);
  if (metadata.source === 'import') return;
  const actorId = change.userId;
  switch (change.entityType) {
    case 'lead': {
      const assigned =
        change.action === 'create'
          ? metadata.source === 'form'
            ? []
            : notActor((await ctx.db.get(change.entityId as Id<'leads'>))?.ownerIds ?? [], actorId)
          : change.action === 'update'
            ? added(metadata.changes?.ownerIds, actorId)
            : [];
      if (assigned.length > 0) {
        await emitEvent(ctx, {
          kind: 'lead.assigned',
          entity: { type: 'lead', id: change.entityId },
          actorId,
          data: { assigned },
        });
      }
      return;
    }
    case 'deal': {
      const entity = { type: 'deal', id: change.entityId } as const;
      if (change.action === 'create') {
        const owners = notActor(
          (await ctx.db.get(change.entityId as Id<'deals'>))?.ownerIds ?? [],
          actorId,
        );
        if (owners.length > 0) {
          await emitEvent(ctx, {
            kind: 'deal.assigned',
            entity,
            actorId,
            data: { assigned: owners },
          });
        }
        return;
      }
      if (change.action !== 'update') return;
      const assigned = added(metadata.changes?.ownerIds, actorId);
      if (assigned.length > 0) {
        await emitEvent(ctx, { kind: 'deal.assigned', entity, actorId, data: { assigned } });
      }
      const stage = metadata.changes?.stageKey;
      if (stage && typeof stage.new === 'string') {
        // The stage's kind is the deal's status, written by the same move.
        const deal = await ctx.db.get(change.entityId as Id<'deals'>);
        if (!deal) return;
        await emitEvent(ctx, {
          kind: deal.status === 'open' ? 'deal.stage_changed' : 'deal.closed',
          entity,
          actorId,
          data: { stageKey: stage.new },
        });
      }
      return;
    }
    case 'activity': {
      const owner =
        change.action === 'create'
          ? (await ctx.db.get(change.entityId as Id<'activities'>))?.ownerId
          : change.action === 'update' && typeof metadata.changes?.ownerId?.new === 'string'
            ? metadata.changes.ownerId.new
            : undefined;
      if (owner && owner !== actorId) {
        await emitEvent(ctx, {
          kind: 'activity.assigned',
          entity: { type: 'activity', id: change.entityId },
          actorId,
          data: { assigned: [owner] },
        });
      }
      return;
    }
    case 'invitation': {
      if (change.action !== 'update' || metadata.event !== 'accepted') return;
      await emitEvent(ctx, {
        kind: 'team.invitation_accepted',
        entity: { type: 'invitation', id: change.entityId },
        // The person who joined is the actor of the acceptance: told nothing about it.
        actorId,
        data: {
          email: typeof metadata.email === 'string' ? metadata.email : '',
          role: typeof metadata.role === 'string' ? metadata.role : '',
        },
      });
      return;
    }
    default:
      return;
  }
}
