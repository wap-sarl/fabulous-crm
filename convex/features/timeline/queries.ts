import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import type { Doc, Id, TableNames } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { employeeQuery } from '../../_lib/auth';
import type { ActivityStatus, ActivityType } from '../../_lib/validators/activities';
import type { AuditLogAction } from '../../_lib/validators/auditLogs';
import type {
  CampaignChannel,
  CampaignEventType,
  CampaignSendStatus,
} from '../../_lib/validators/crm';
import type { DealStatus } from '../../_lib/validators/deals';
import type { LifecycleChangeSource } from '../../_lib/validators/lifecycle';
import {
  TIMELINE_KINDS,
  type TimelineKind,
  timelineKindValidator,
} from '../../_lib/validators/timeline';
import type { WorkflowRunStatus } from '../../_lib/validators/workflows';
import { isNotDeleted } from '../../lib';
import {
  paginateTimeline,
  type TimelineRow,
  type TimelineSource,
  type TimelineWindow,
  withinWindow,
} from '../../lib/timeline';

interface TimelineEventBase<K extends TimelineKind> {
  kind: K;
  /** Source document id — unique across the feed. */
  id: string;
  /** Sort key: when the event happened. */
  at: number;
}

/** One entry of a lead's timeline; discriminated on `kind`. */
export type TimelineEvent =
  | (TimelineEventBase<'note'> & {
      noteId: Id<'leadNotes'>;
      content: string;
      isPinned: boolean;
      authorName: string | null;
    })
  | (TimelineEventBase<'activity'> & {
      activityId: Id<'activities'>;
      type: ActivityType;
      title: string;
      status: ActivityStatus;
      dueAt: number | null;
      completedAt: number | null;
      outcome: string | null;
      ownerName: string | null;
    })
  | (TimelineEventBase<'campaign_send'> & {
      campaignId: Id<'campaigns'>;
      campaignName: string;
      channel: CampaignChannel;
      status: CampaignSendStatus;
      sentAt: number | null;
      error: string | null;
    })
  | (TimelineEventBase<'campaign_event'> & {
      campaignId: Id<'campaigns'>;
      campaignName: string;
      type: CampaignEventType;
      url: string | null;
      linkLabel: string | null;
      reason: string | null;
    })
  | (TimelineEventBase<'workflow_run'> & {
      runId: Id<'workflowRuns'>;
      workflowId: Id<'workflows'>;
      workflowName: string | null;
      status: WorkflowRunStatus;
      manual: boolean;
      finishedAt: number | null;
      error: string | null;
    })
  | (TimelineEventBase<'lifecycle'> & {
      from: string | null;
      to: string;
      source: LifecycleChangeSource;
      changedByName: string | null;
      workflowName: string | null;
    })
  | (TimelineEventBase<'deal'> & {
      dealId: Id<'deals'>;
      title: string;
      amount: number | null;
      currency: string;
      status: DealStatus;
      stageLabel: string | null;
      pipelineName: string | null;
    })
  | (TimelineEventBase<'audit'> & {
      action: AuditLogAction;
      userName: string | null;
      /** Lead fields touched by an update. */
      fields: string[];
      /** The lead absorbed by a merge. */
      absorbedLeadName: string | null;
    });

/** Memoized point reads shared by every event built for one page. */
function docLoader(ctx: QueryCtx) {
  const cache = new Map<string, Promise<unknown>>();
  const get = <T extends TableNames>(id: Id<T>): Promise<Doc<T> | null> => {
    let pending = cache.get(id);
    if (!pending) {
      pending = ctx.db.get(id);
      cache.set(id, pending);
    }
    return pending as Promise<Doc<T> | null>;
  };
  const userName = async (id: Id<'users'> | undefined): Promise<string | null> => {
    const user = id ? await get(id) : null;
    return user ? `${user.firstName} ${user.lastName}` : null;
  };
  return { get, userName };
}
type Loader = ReturnType<typeof docLoader>;

/** `collect` for a pinned page re-read, `take` for a fresh page. */
function fetchRows<T>(
  query: { collect: () => Promise<T[]>; take: (n: number) => Promise<T[]> },
  limit: number | undefined,
): Promise<T[]> {
  return limit === undefined ? query.collect() : query.take(limit);
}

type SourceFactory = (
  ctx: QueryCtx,
  leadId: Id<'leads'>,
  load: Loader,
) => TimelineSource<TimelineEvent>;

type Row = TimelineRow<TimelineEvent>;

const SOURCES: Record<TimelineKind, SourceFactory> = {
  note: (ctx, leadId, { userName }) => ({
    kind: 'note',
    load: async (w: TimelineWindow, limit?: number): Promise<Row[]> => {
      const rows = await fetchRows(
        ctx.db
          .query('leadNotes')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((note) => ({
        at: note._creationTime,
        build: async () =>
          isNotDeleted(note)
            ? {
                kind: 'note',
                id: note._id,
                at: note._creationTime,
                noteId: note._id,
                content: note.content,
                isPinned: note.isPinned,
                authorName: await userName(note.createdBy),
              }
            : null,
      }));
    },
  }),

  activity: (ctx, leadId, { userName }) => ({
    kind: 'activity',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('activities')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((activity) => ({
        at: activity._creationTime,
        build: async () =>
          isNotDeleted(activity)
            ? {
                kind: 'activity',
                id: activity._id,
                at: activity._creationTime,
                activityId: activity._id,
                type: activity.type,
                title: activity.title,
                status: activity.status,
                dueAt: activity.dueAt ?? null,
                completedAt: activity.completedAt ?? null,
                outcome: activity.outcome ?? null,
                ownerName: await userName(activity.ownerId),
              }
            : null,
      }));
    },
  }),

  campaign_send: (ctx, leadId, { get }) => ({
    kind: 'campaign_send',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('campaignSends')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((send) => ({
        at: send._creationTime,
        build: async () => {
          const campaign = await get(send.campaignId);
          return {
            kind: 'campaign_send',
            id: send._id,
            at: send._creationTime,
            campaignId: send.campaignId,
            campaignName: campaign?.name ?? 'Campagne supprimée',
            channel: campaign?.channel ?? 'email',
            status: send.status,
            sentAt: send.sentAt ?? null,
            error: send.error ?? null,
          };
        },
      }));
    },
  }),

  campaign_event: (ctx, leadId, { get }) => ({
    kind: 'campaign_event',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('campaignEvents')
          .withIndex('by_lead_eventAt', (q) => withinWindow(q.eq('leadId', leadId), 'eventAt', w))
          .order('desc'),
        limit,
      );
      return rows.map((event) => ({
        at: event.eventAt,
        build: async () => {
          const campaign = await get(event.campaignId);
          return {
            kind: 'campaign_event',
            id: event._id,
            at: event.eventAt,
            campaignId: event.campaignId,
            campaignName: campaign?.name ?? 'Campagne supprimée',
            type: event.type,
            url: event.url ?? null,
            linkLabel: event.linkLabel ?? null,
            reason: event.reason ?? null,
          };
        },
      }));
    },
  }),

  workflow_run: (ctx, leadId, { get }) => ({
    kind: 'workflow_run',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('workflowRuns')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((run) => ({
        at: run._creationTime,
        build: async () => {
          const workflow = await get(run.workflowId);
          return {
            kind: 'workflow_run',
            id: run._id,
            at: run._creationTime,
            runId: run._id,
            workflowId: run.workflowId,
            workflowName: workflow?.name ?? null,
            status: run.status,
            manual: run.manual ?? false,
            finishedAt: run.finishedAt ?? null,
            error: run.error ?? null,
          };
        },
      }));
    },
  }),

  lifecycle: (ctx, leadId, { get, userName }) => ({
    kind: 'lifecycle',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('lifecycleStageHistory')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((row) => ({
        at: row._creationTime,
        build: async () => ({
          kind: 'lifecycle',
          id: row._id,
          at: row._creationTime,
          from: row.from ?? null,
          to: row.to,
          source: row.source,
          changedByName: await userName(row.changedBy),
          workflowName: row.workflowId ? ((await get(row.workflowId))?.name ?? null) : null,
        }),
      }));
    },
  }),

  deal: (ctx, leadId, { get }) => ({
    kind: 'deal',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('deals')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((deal) => ({
        at: deal._creationTime,
        build: async () => {
          if (!isNotDeleted(deal)) return null;
          const pipeline = await get(deal.pipelineId);
          return {
            kind: 'deal',
            id: deal._id,
            at: deal._creationTime,
            dealId: deal._id,
            title: deal.title,
            amount: deal.amount ?? null,
            currency: deal.currency,
            status: deal.status,
            stageLabel: pipeline?.stages.find((s) => s.key === deal.stageKey)?.label ?? null,
            pipelineName: pipeline?.name ?? null,
          };
        },
      }));
    },
  }),

  audit: (ctx, leadId, { userName }) => ({
    kind: 'audit',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('auditLogs')
          .withIndex('by_entity', (q) =>
            withinWindow(q.eq('entityType', 'lead').eq('entityId', leadId), '_creationTime', w),
          )
          .order('desc'),
        limit,
      );
      return rows.map((log) => ({
        at: log._creationTime,
        build: async () => {
          if (log.action === 'delete') return null;
          const metadata = log.metadata as
            | { changes?: Record<string, unknown>; absorbedLeadName?: string }
            | undefined;
          return {
            kind: 'audit',
            id: log._id,
            at: log._creationTime,
            action: log.action,
            userName: await userName(log.userId),
            fields: Object.keys(metadata?.changes ?? {}),
            absorbedLeadName: metadata?.absorbedLeadName ?? null,
          };
        },
      }));
    },
  }),
};

export const listLeadTimeline = employeeQuery({
  args: {
    leadId: v.id('leads'),
    kinds: v.optional(v.array(timelineKindValidator)),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId);
    if (!lead || !isNotDeleted(lead)) {
      return { page: [] as TimelineEvent[], isDone: true, continueCursor: '' };
    }
    const kinds = TIMELINE_KINDS.filter((k) => !args.kinds || args.kinds.includes(k));
    const loader = docLoader(ctx);
    return paginateTimeline(
      kinds.map((kind) => SOURCES[kind](ctx, args.leadId, loader)),
      args.paginationOpts,
    );
  },
});
