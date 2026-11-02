import { type Infer, v } from 'convex/values';

/** What a person can be told about: a closed catalogue, like the plugins'; `defaultOn` is the choice until the person sets theirs. */
const NOTIFICATION_KINDS = [
  { key: 'lead.assigned', group: 'leads', label: 'Un lead vous est attribué', defaultOn: true },
  {
    key: 'lead.form_submitted',
    group: 'leads',
    label: 'Un formulaire que vous possédez reçoit un envoi',
    defaultOn: true,
  },
  {
    key: 'deal.assigned',
    group: 'deals',
    label: 'Une transaction vous est attribuée',
    defaultOn: true,
  },
  {
    key: 'deal.stage_changed',
    group: 'deals',
    label: 'Une de vos transactions change de stade',
    defaultOn: true,
  },
  {
    key: 'deal.closed',
    group: 'deals',
    label: 'Une transaction de votre équipe est gagnée ou perdue',
    defaultOn: true,
  },
  {
    key: 'activity.assigned',
    group: 'activities',
    label: 'Une tâche vous est attribuée',
    defaultOn: true,
  },
  {
    key: 'campaign.finished',
    group: 'campaigns',
    label: 'Une campagne que vous avez créée est terminée ou en échec',
    defaultOn: true,
  },
  {
    key: 'workflow.run_failed',
    group: 'campaigns',
    label: 'Une étape de workflow a échoué',
    defaultOn: true,
  },
  { key: 'import.finished', group: 'imports', label: 'Votre import est terminé', defaultOn: true },
  {
    key: 'team.invitation_accepted',
    group: 'team',
    label: 'Une personne invitée a rejoint le CRM',
    defaultOn: false,
  },
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]['key'];
export type NotificationGroup = (typeof NOTIFICATION_KINDS)[number]['group'];

const KIND_KEYS = NOTIFICATION_KINDS.map((kind) => kind.key) as [
  NotificationKind,
  ...NotificationKind[],
];

export const notificationGroupOf = (kind: NotificationKind): NotificationGroup =>
  NOTIFICATION_KINDS.find((entry) => entry.key === kind)?.group ?? 'leads';

/** Whether a kind is told until the person chooses: the catalogue's default. */
export const notificationKindOnByDefault = (kind: NotificationKind): boolean =>
  NOTIFICATION_KINDS.find((entry) => entry.key === kind)?.defaultOn ?? true;

// A kind the catalogue drops fails loudly at deploy, never silently in a row.
const notificationKindValidator = v.union(...KIND_KEYS.map((key) => v.literal(key)));

/** The record a notification is about; `path` on the notification is where it opens. */
const notificationEntityValidator = v.object({
  type: v.union(
    v.literal('lead'),
    v.literal('deal'),
    v.literal('activity'),
    v.literal('campaign'),
    v.literal('workflowRun'),
    v.literal('importJob'),
    v.literal('invitation'),
  ),
  id: v.string(),
});
export type NotificationEntity = Infer<typeof notificationEntityValidator>;

/** What the producer knows and the fan-out cannot read back from the record: the people newly assigned, a form, a count, a reason. */
const notificationEventDataValidator = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean(), v.array(v.string())),
);
export type NotificationEventData = Infer<typeof notificationEventDataValidator>;

/** A fact, written in the writer's transaction; a queue the fan-out drains, not a history. */
export const notificationEventValidator = v.object({
  kind: notificationKindValidator,
  entity: notificationEntityValidator,
  actorId: v.optional(v.id('users')),
  at: v.number(),
  data: v.optional(notificationEventDataValidator),
});

/** A fact addressed to one person, with its own read state. */
export const notificationValidator = v.object({
  userId: v.id('users'),
  kind: notificationKindValidator,
  title: v.string(),
  body: v.string(),
  path: v.string(),
  entity: notificationEntityValidator,
  actorId: v.optional(v.id('users')),
  // `kind:entityId:userId`: the same fact twice rings once while the first is unread.
  dedupeKey: v.string(),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
});

const notificationDeliveryStatusValidator = v.union(
  v.literal('pending'),
  v.literal('sent'),
  v.literal('failed'),
  v.literal('skipped'),
);

/** One delivery of a notification on an external channel; the scheduler carries its retries. */
export const notificationDeliveryValidator = v.object({
  notificationId: v.id('notifications'),
  channel: v.string(),
  status: notificationDeliveryStatusValidator,
  attempts: v.number(),
  nextAt: v.number(),
  error: v.optional(v.string()),
  createdAt: v.number(),
});

/** One row per person: the kinds they turned on or off (absent = the catalogue's default) and the channels they chose. */
export const notificationPreferencesValidator = v.object({
  userId: v.id('users'),
  kinds: v.record(v.string(), v.boolean()),
  channels: v.record(
    v.string(),
    v.object({ enabled: v.boolean(), target: v.optional(v.string()) }),
  ),
  updatedAt: v.number(),
});

/** The fan-out drains this many events per run; a run that drained a full batch schedules the next. */
export const NOTIFICATION_FAN_OUT_BATCH = 50;
/** The unread count is read up to here and shown as « 99+ » past 99. */
export const NOTIFICATION_UNREAD_CAP = 100;
/** The popover shows the latest this many. */
export const NOTIFICATION_LATEST = 20;
