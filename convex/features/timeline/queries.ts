import { paginationResultValidator } from 'convex/server';
import { activityTypeValidator } from '../../_lib/validators/activities';
import { activityStatusValidator } from '../../_lib/validators/activities';
import { campaignChannelValidator } from '../../_lib/validators/crm';
import { campaignSendStatusValidator } from '../../_lib/validators/crm';
import { campaignEventTypeValidator } from '../../_lib/validators/crm';
import { workflowRunStatusValidator } from '../../_lib/validators/workflows';
import { lifecycleChangeSourceValidator } from '../../_lib/validators/lifecycle';
import { dealStatusValidator } from '../../_lib/validators/deals';
import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { employeeQuery } from '../../_lib/auth';
import { TIMELINE_KINDS, timelineKindValidator } from '../../_lib/validators/timeline';
import { isNotDeleted } from '../../lib/shared/db';
import { paginateTimeline } from '../../lib/timeline/pagination';
import type { TimelineEvent } from '../../lib/timeline/events';
import { docLoader, SOURCES } from '../../lib/timeline/sources';

export const listLeadTimeline = employeeQuery({
  args: {
    leadId: v.id('leads'),
    kinds: v.optional(v.array(timelineKindValidator)),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.union(
      v.object({
        kind: v.literal('note'),
        id: v.string(),
        at: v.number(),
        noteId: v.id('leadNotes'),
        content: v.string(),
        isPinned: v.boolean(),
        authorName: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('activity'),
        id: v.string(),
        at: v.number(),
        activityId: v.id('activities'),
        type: activityTypeValidator,
        title: v.string(),
        status: activityStatusValidator,
        dueAt: v.union(v.number(), v.null()),
        completedAt: v.union(v.number(), v.null()),
        outcome: v.union(v.string(), v.null()),
        ownerName: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('campaign_send'),
        id: v.string(),
        at: v.number(),
        campaignId: v.id('campaigns'),
        campaignName: v.string(),
        channel: campaignChannelValidator,
        status: campaignSendStatusValidator,
        sentAt: v.union(v.number(), v.null()),
        error: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('campaign_event'),
        id: v.string(),
        at: v.number(),
        campaignId: v.id('campaigns'),
        campaignName: v.string(),
        type: campaignEventTypeValidator,
        url: v.union(v.string(), v.null()),
        linkLabel: v.union(v.string(), v.null()),
        reason: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('form_submission'),
        id: v.string(),
        at: v.number(),
        formId: v.id('forms'),
        formName: v.string(),
        fieldLabels: v.array(v.string()),
      }),
      v.object({
        kind: v.literal('page_view'),
        id: v.string(),
        at: v.number(),
        url: v.string(),
        path: v.string(),
        title: v.union(v.string(), v.null()),
        referrer: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('workflow_run'),
        id: v.string(),
        at: v.number(),
        runId: v.id('workflowRuns'),
        workflowId: v.id('workflows'),
        workflowName: v.union(v.string(), v.null()),
        status: workflowRunStatusValidator,
        manual: v.boolean(),
        finishedAt: v.union(v.number(), v.null()),
        error: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('lifecycle'),
        id: v.string(),
        at: v.number(),
        from: v.union(v.string(), v.null()),
        to: v.string(),
        source: lifecycleChangeSourceValidator,
        changedByName: v.union(v.string(), v.null()),
        workflowName: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('deal'),
        id: v.string(),
        at: v.number(),
        dealId: v.id('deals'),
        title: v.string(),
        amount: v.union(v.number(), v.null()),
        currency: v.string(),
        status: dealStatusValidator,
        stageLabel: v.union(v.string(), v.null()),
        stageTags: v.array(v.string()),
        stageComment: v.union(v.string(), v.null()),
        pipelineName: v.union(v.string(), v.null()),
      }),
      v.object({
        kind: v.literal('audit'),
        id: v.string(),
        at: v.number(),
        action: v.union(
          v.literal('create'),
          v.literal('update'),
          v.literal('delete'),
          v.literal('merge'),
        ),
        userName: v.union(v.string(), v.null()),
        fields: v.array(v.string()),
        absorbedLeadName: v.union(v.string(), v.null()),
      }),
    ),
  ),
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
