import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  type NotificationKind,
  notificationKindOnByDefault,
} from '../../_lib/validators/notifications';
import { loadVisibility } from '../roles/visibility';
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

/** Writes the inbox rows of one fact: the text rendered once from the record, one row per recipient, none for a recipient whose unread row of the same key is still there. */
export async function fanOutEvent(
  ctx: MutationCtx,
  event: Doc<'notificationEvents'>,
): Promise<number> {
  const rendered = await RENDERERS[event.kind](ctx, event);
  if (!rendered) return 0;
  const recipients = await recipientsOf(ctx, rendered.recipients, {
    actorId: event.actorId,
    tellActor: rendered.tellActor,
  });
  let written = 0;
  for (const user of recipients) {
    if (!wants(user, event.kind)) continue;
    // The record's own access rules bound the inbox: a person who could not open it is not told of it.
    if (rendered.visible && !rendered.visible(await loadVisibility(ctx, user))) continue;
    const dedupeKey = dedupeKeyOf(event.kind, event.entity.id, user._id);
    const unread = await ctx.db
      .query('notifications')
      .withIndex('by_dedupe_unread', (q) => q.eq('dedupeKey', dedupeKey).eq('readAt', undefined))
      .first();
    if (unread) continue;
    await ctx.db.insert('notifications', {
      userId: user._id,
      kind: event.kind,
      title: rendered.title,
      body: rendered.body,
      path: rendered.path,
      entity: event.entity,
      actorId: event.actorId,
      dedupeKey,
      createdAt: event.at,
      deliveredAt: Date.now(),
    });
    written += 1;
  }
  return written;
}
