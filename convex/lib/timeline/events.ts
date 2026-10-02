import type { Id } from '../../_generated/dataModel';
import type { ActivityStatus, ActivityType } from '../../_lib/validators/activities';
import type { AuditLogAction } from '../../_lib/validators/auditLogs';
import type {
  CampaignChannel,
  CampaignEventType,
  CampaignSendStatus,
} from '../../_lib/validators/crm';
import type { DealStatus } from '../../_lib/validators/deals';
import type { LifecycleChangeSource } from '../../_lib/validators/lifecycle';
import type { TimelineKind } from '../../_lib/validators/timeline';
import type { WorkflowRunStatus } from '../../_lib/validators/workflows';

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
  | (TimelineEventBase<'form_submission'> & {
      formId: Id<'forms'>;
      formName: string;
      /** Submitted field labels (values stay in the CRM record, not the feed). */
      fieldLabels: string[];
    })
  | (TimelineEventBase<'page_view'> & {
      url: string;
      path: string;
      title: string | null;
      referrer: string | null;
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
      stageTags: string[];
      stageComment: string | null;
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
