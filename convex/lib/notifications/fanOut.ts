import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  type NotificationKind,
  notificationKindOnByDefault,
} from '../../_lib/validators/notifications';
import { loadVisibility, scopedReader, type Visibility } from '../roles/visibility';
import { recipientsOf } from './audience';
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

/** Whether this person is told this kind: the catalogue's default until the preferences of #171 say otherwise. */
const wants = (_user: Doc<'users'>, kind: NotificationKind): boolean =>
  notificationKindOnByDefault(kind);

/** The visibilities loaded during one run, one per person: a batch addressed to the settings right reads each once. */
export type VisibilityCache = Map<string, Promise<Visibility>>;

const visibilityOf = (ctx: MutationCtx, cache: VisibilityCache, user: Doc<'users'>) => {
  let loading = cache.get(user._id);
  if (!loading) {
    loading = loadVisibility(ctx, user);
    cache.set(user._id, loading);
  }
  return loading;
};

/** Whether the person could open the record: read through their own scoped reader, the rules the record's page applies. */
async function canOpen(
  ctx: MutationCtx,
  cache: VisibilityCache,
  user: Doc<'users'>,
  record: NonNullable<Rendered['record']>,
): Promise<boolean> {
  const id = ctx.db.normalizeId(record.table, record.id);
  if (!id) return false;
  const visibility = await visibilityOf(ctx, cache, user);
  return (await scopedReader(ctx, visibility).get(id)) !== null;
}

/** Writes the inbox rows of one fact: the text rendered once from the record, one row per recipient; a recipient whose unread row of the same key is still there gets that row refreshed with the latest news instead of a second one. */
export async function fanOutEvent(
  ctx: MutationCtx,
  event: Doc<'notificationEvents'>,
  cache: VisibilityCache = new Map(),
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
      await ctx.db.patch(own._id, news);
      written += 1;
    }
  }
  for (const user of recipients) {
    if (!wants(user, event.kind)) continue;
    // The record's own access rules bound the inbox: a person who could not open it is not told of it.
    if (rendered.record && !(await canOpen(ctx, cache, user, rendered.record))) continue;
    const dedupeKey = dedupeKeyOf(event.kind, event.entity.id, user._id);
    const unread = await unreadOf(user._id);
    if (unread) {
      // One row, the latest news: a deal moved twice while unread shows where it is now.
      await ctx.db.patch(unread._id, news);
    } else {
      await ctx.db.insert('notifications', {
        userId: user._id,
        kind: event.kind,
        entity: event.entity,
        dedupeKey,
        ...news,
      });
    }
    written += 1;
  }
  return written;
}
