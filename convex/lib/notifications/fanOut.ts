import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { NotificationKind } from '../../_lib/validators/notifications';
import { loadVisibility, type Visibility } from '../roles/visibility';
import { canOpenRecord } from './access';
import { recipientsOf } from './audience';
import { availableChannels, type NotificationChannel } from './channels';
import { queueDeliveries } from './deliveries';
import { kindIsOn, preferencesOf } from './preferences';
import {
  type Rendered,
  renderActivityAssigned,
  renderCampaignFinished,
  renderDealAssigned,
  renderDealClosed,
  renderDealStageChanged,
  renderFormSubmitted,
  renderImportFinished,
  renderInvitationAccepted,
  renderLeadAssigned,
  renderWorkflowRunFailed,
} from './render';

// One fact becomes one inbox row per person it concerns.

type Renderer = (ctx: MutationCtx, event: Doc<'notificationEvents'>) => Promise<Rendered | null>;

const RENDERERS: Record<NotificationKind, Renderer> = {
  'lead.assigned': renderLeadAssigned,
  'lead.form_submitted': renderFormSubmitted,
  'deal.assigned': renderDealAssigned,
  'deal.stage_changed': renderDealStageChanged,
  'deal.closed': renderDealClosed,
  'activity.assigned': renderActivityAssigned,
  'campaign.finished': renderCampaignFinished,
  'workflow.run_failed': renderWorkflowRunFailed,
  'import.finished': renderImportFinished,
  'team.invitation_accepted': renderInvitationAccepted,
};

const dedupeKeyOf = (kind: NotificationKind, entityId: string, userId: string): string =>
  `${kind}:${entityId}:${userId}`;

/** What one run loads once and keeps: a person's visibility and their preferences, however many facts concern them, and the channels that can deliver. */
export interface FanOutRun {
  visibilities: Map<string, Promise<Visibility>>;
  preferences: Map<string, Promise<Doc<'notificationPreferences'> | null>>;
  channels?: Promise<NotificationChannel[]>;
}

export const newFanOutRun = (): FanOutRun => ({ visibilities: new Map(), preferences: new Map() });

function once<V>(cache: Map<string, Promise<V>>, key: string, load: () => Promise<V>): Promise<V> {
  let loading = cache.get(key);
  if (!loading) {
    loading = load();
    cache.set(key, loading);
  }
  return loading;
}

/** Writes the inbox rows of one fact: the text rendered once from the record, one row per recipient who wants the kind; a recipient whose unread row of the same key is still there gets that row refreshed with the latest news instead of a second one. Each row written is queued on the external channels its reader turned on. */
export async function fanOutEvent(
  ctx: MutationCtx,
  event: Doc<'notificationEvents'>,
  run: FanOutRun = newFanOutRun(),
): Promise<number> {
  const rendered = await RENDERERS[event.kind](ctx, event);
  if (!rendered) return 0;
  const recipients = await recipientsOf(ctx, rendered.recipients, {
    actorId: event.actorId,
    tellActor: rendered.tellActor,
  });
  const news = {
    title: rendered.title,
    body: rendered.body,
    path: rendered.path,
    record: rendered.record,
    actorId: event.actorId,
    createdAt: event.at,
    deliveredAt: Date.now(),
  };
  const unreadOf = (userId: Id<'users'>) =>
    ctx.db
      .query('notifications')
      .withIndex('by_dedupe_unread', (q) =>
        q.eq('dedupeKey', dedupeKeyOf(event.kind, event.entity.id, userId)).eq('readAt', undefined),
      )
      .first();
  let written = 0;
  // The actor is not told of their own change, but a row they have not read yet must not keep an older state of the record.
  if (event.actorId && !rendered.tellActor && rendered.recipients.includes(event.actorId)) {
    const own = await unreadOf(event.actorId);
    if (own) {
      await ctx.db.patch(own._id, { ...news, body: rendered.ownBody ?? rendered.body });
      written += 1;
    }
  }
  for (const user of recipients) {
    // A kind the person turned off costs this lookup and writes nothing.
    const preferences = await once(run.preferences, user._id, () => preferencesOf(ctx, user._id));
    if (!kindIsOn(preferences, event.kind)) continue;
    // The record's own access rules bound the inbox: a person who could not open it is not told of it.
    if (rendered.record) {
      const visibility = await once(run.visibilities, user._id, () => loadVisibility(ctx, user));
      if (!(await canOpenRecord(ctx, visibility, rendered.record))) continue;
    }
    const dedupeKey = dedupeKeyOf(event.kind, event.entity.id, user._id);
    const unread = await unreadOf(user._id);
    // One row, the latest news: a deal moved twice while unread shows where it is now.
    if (unread) await ctx.db.patch(unread._id, news);
    const notificationId =
      unread?._id ??
      (await ctx.db.insert('notifications', {
        userId: user._id,
        kind: event.kind,
        entity: event.entity,
        dedupeKey,
        ...news,
      }));
    written += 1;
    // Nobody is on an external channel until they say so: without a row there is nothing to queue, and the channels are not even read.
    if (!preferences || !Object.values(preferences.channels).some((choice) => choice.enabled)) {
      continue;
    }
    run.channels ??= availableChannels(ctx);
    await queueDeliveries(ctx, await run.channels, preferences, notificationId);
  }
  return written;
}
