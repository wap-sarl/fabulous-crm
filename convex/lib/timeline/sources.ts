import type { Doc, Id, TableNames } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { stageTagLabels } from '../../_lib/validators/deals';
import type { TimelineKind } from '../../_lib/validators/timeline';
import { isNotDeleted } from '../shared/db';
import {
  type TimelineRow,
  type TimelineSource,
  type TimelineWindow,
  withinWindow,
} from './pagination';
import type { TimelineEvent } from './events';

/** Memoized point reads shared by every event built for one page. */
export function docLoader(ctx: QueryCtx) {
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
  /** The employee, or the REST API key, behind an audit row. */
  const actorName = async (log: {
    userId?: Id<'users'>;
    apiKeyId?: Id<'apiKeys'>;
  }): Promise<string | null> => {
    if (log.apiKeyId) {
      const key = await get(log.apiKeyId);
      return key ? `API · ${key.name}` : 'API';
    }
    return await userName(log.userId);
  };
  return { get, userName, actorName };
}
type Loader = ReturnType<typeof docLoader>;

/** `collect` for a pinned page re-read, `take` for a fresh page. */
function fetchRows<T>(
  query: { collect: () => Promise<T[]>; take: (n: number) => Promise<T[]> },
  limit: number | undefined,
): Promise<T[]> {
  return limit === undefined ? query.collect() : query.take(limit);
}

/** Who signs an audit entry no employee or API key made: the system writer named by `metadata.source`. */
const SYSTEM_ACTOR: Record<string, string> = {
  public_link: 'Lien de préférences',
  sms_stop: 'Réponse STOP par SMS',
  tracked_link: 'Lien de campagne',
  workflow: 'Workflow',
  form: 'Formulaire public',
};

export type SourceFactory = (
  ctx: QueryCtx,
  leadId: Id<'leads'>,
  load: Loader,
) => TimelineSource<TimelineEvent>;

type Row = TimelineRow<TimelineEvent>;

export const SOURCES: Record<TimelineKind, SourceFactory> = {
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

  form_submission: (ctx, leadId, { get }) => ({
    kind: 'form_submission',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('formSubmissions')
          .withIndex('by_lead', (q) => withinWindow(q.eq('leadId', leadId), '_creationTime', w))
          .order('desc'),
        limit,
      );
      return rows.map((submission) => ({
        at: submission._creationTime,
        build: async () => {
          const form = await get(submission.formId);
          // Labels in form-field order (record keys come back sorted from Convex).
          const fieldLabels = form
            ? form.fields.filter((f) => submission.values[f.key] !== undefined).map((f) => f.label)
            : Object.keys(submission.values);
          return {
            kind: 'form_submission',
            id: submission._id,
            at: submission._creationTime,
            formId: submission.formId,
            formName: form?.name ?? 'Formulaire supprimé',
            fieldLabels,
          };
        },
      }));
    },
  }),

  page_view: (ctx, leadId) => ({
    kind: 'page_view',
    load: async (w, limit) => {
      const rows = await fetchRows(
        ctx.db
          .query('pageViews')
          .withIndex('by_lead_at', (q) => withinWindow(q.eq('leadId', leadId), 'at', w))
          .order('desc'),
        limit,
      );
      return rows.map((view) => ({
        at: view.at,
        build: async () => ({
          kind: 'page_view',
          id: view._id,
          at: view.at,
          url: view.url,
          path: view.path,
          title: view.title ?? null,
          referrer: view.referrer ?? null,
        }),
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
          const stage = pipeline?.stages.find((s) => s.key === deal.stageKey);
          return {
            kind: 'deal',
            id: deal._id,
            at: deal._creationTime,
            dealId: deal._id,
            title: deal.title,
            amount: deal.amount ?? null,
            currency: deal.currency,
            status: deal.status,
            stageLabel: stage?.label ?? null,
            stageTags: stageTagLabels(stage, deal.stageTags),
            stageComment: deal.stageComment ?? null,
            pipelineName: pipeline?.name ?? null,
          };
        },
      }));
    },
  }),

  audit: (ctx, leadId, { actorName }) => ({
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
            | { changes?: Record<string, unknown>; absorbedLeadName?: string; source?: string }
            | undefined;
          return {
            kind: 'audit',
            id: log._id,
            at: log._creationTime,
            action: log.action,
            userName: (await actorName(log)) ?? SYSTEM_ACTOR[metadata?.source ?? ''] ?? null,
            fields: Object.keys(metadata?.changes ?? {}),
            absorbedLeadName: metadata?.absorbedLeadName ?? null,
          };
        },
      }));
    },
  }),
};
