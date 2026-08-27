import { type Infer, v } from 'convex/values';

export const TIMELINE_KINDS = [
  'note',
  'activity',
  'campaign_send',
  'campaign_event',
  'workflow_run',
  'lifecycle',
  'deal',
  'audit',
] as const;

export const timelineKindValidator = v.union(
  v.literal('note'),
  v.literal('activity'),
  v.literal('campaign_send'),
  v.literal('campaign_event'),
  v.literal('workflow_run'),
  v.literal('lifecycle'),
  v.literal('deal'),
  v.literal('audit'),
);

export type TimelineKind = Infer<typeof timelineKindValidator>;
