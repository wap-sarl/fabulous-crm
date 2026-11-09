import { type Infer, v } from 'convex/values';
import { z } from 'zod';
import type { AccessModule, RoleAccess } from './access';

/** One kind of the catalogue; `module` and `settings` say which roles it can reach at all: a role without that module, or without the settings right, is never told. */
interface NotificationKindEntry {
  key: string;
  group: string;
  label: string;
  defaultOn: boolean;
  module?: AccessModule;
  settings?: true;
}

/** What a person can be told about: a closed catalogue, like the plugins'; `defaultOn` is the choice until the person sets theirs. */
const NOTIFICATION_KINDS = [
  {
    key: 'lead.assigned',
    group: 'leads',
    label: 'Un lead vous est attribué',
    defaultOn: true,
    module: 'leads',
  },
  {
    key: 'lead.form_submitted',
    group: 'leads',
    label: 'Un formulaire que vous possédez reçoit un envoi',
    defaultOn: true,
    module: 'leads',
  },
  {
    key: 'deal.assigned',
    group: 'deals',
    label: 'Une transaction vous est attribuée',
    defaultOn: true,
    module: 'deals',
  },
  {
    key: 'deal.stage_changed',
    group: 'deals',
    label: 'Une de vos transactions change de stade',
    defaultOn: true,
    module: 'deals',
  },
  {
    key: 'deal.closed',
    group: 'deals',
    label: 'Une transaction de votre équipe est gagnée ou perdue',
    defaultOn: true,
    module: 'deals',
  },
  {
    key: 'activity.assigned',
    group: 'activities',
    label: 'Une tâche vous est attribuée',
    defaultOn: true,
    module: 'activities',
  },
  {
    key: 'campaign.finished',
    group: 'campaigns',
    label: 'Une campagne que vous avez créée est terminée ou en échec',
    defaultOn: true,
    module: 'campaigns',
  },
  {
    key: 'workflow.run_failed',
    group: 'campaigns',
    label: 'Une étape de workflow a échoué',
    defaultOn: true,
    module: 'workflows',
    settings: true,
  },
  { key: 'import.finished', group: 'imports', label: 'Votre import est terminé', defaultOn: true },
  {
    key: 'team.invitation_accepted',
    group: 'team',
    label: 'Une personne invitée a rejoint le CRM',
    defaultOn: false,
    settings: true,
  },
] as const satisfies readonly NotificationKindEntry[];

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]['key'];
export type NotificationGroup = (typeof NOTIFICATION_KINDS)[number]['group'];

const KIND_KEYS = NOTIFICATION_KINDS.map((kind) => kind.key) as [
  NotificationKind,
  ...NotificationKind[],
];

export const notificationGroupOf = (kind: NotificationKind): NotificationGroup =>
  NOTIFICATION_KINDS.find((entry) => entry.key === kind)?.group ?? 'leads';

/** A kind as the settings page names it: what an external message says when it may not carry the record's name. */
export const notificationKindLabel = (kind: NotificationKind): string =>
  NOTIFICATION_KINDS.find((entry) => entry.key === kind)?.label ?? kind;

/** Whether a kind is told until the person chooses: the catalogue's default. */
export const notificationKindOnByDefault = (kind: NotificationKind): boolean =>
  NOTIFICATION_KINDS.find((entry) => entry.key === kind)?.defaultOn ?? true;

/** The kinds a role can receive: the settings page shows these, a switch that could change nothing is not shown. */
export const notificationKindsFor = (access: RoleAccess) =>
  NOTIFICATION_KINDS.filter((kind) => {
    const { module, settings }: NotificationKindEntry = kind;
    return (!settings || access.settings) && (!module || access[module] !== 'none');
  });

// A kind the catalogue drops fails loudly at deploy, never silently in a row.
export const notificationKindValidator = v.union(...KIND_KEYS.map((key) => v.literal(key)));

const GROUP_KEYS = [...new Set(NOTIFICATION_KINDS.map((kind) => kind.group))];
export const notificationGroupValidator = v.union(...GROUP_KEYS.map((key) => v.literal(key)));

/** The kinds a person turns on or off in one call: known kinds only, any subset of them. */
export const notificationKindChoicesSchema = z.partialRecord(z.enum(KIND_KEYS), z.boolean());

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

/** The record whose access rules bound a notification: the one its reader must be able to open. */
const notificationRecordValidator = v.object({
  table: v.union(
    v.literal('leads'),
    v.literal('deals'),
    v.literal('activities'),
    v.literal('campaigns'),
    v.literal('workflows'),
  ),
  id: v.string(),
});
export type NotificationRecord = Infer<typeof notificationRecordValidator>;

/** A fact addressed to one person, with its own read state. */
export const notificationValidator = v.object({
  userId: v.id('users'),
  kind: notificationKindValidator,
  title: v.string(),
  body: v.string(),
  path: v.string(),
  entity: notificationEntityValidator,
  // Kept so a delivery that leaves later asks again whether its reader can still open it.
  record: v.optional(notificationRecordValidator),
  actorId: v.optional(v.id('users')),
  // `kind:entityId:userId`: the same fact twice rings once while the first is unread.
  dedupeKey: v.string(),
  readAt: v.optional(v.number()),
  // When the fact happened, shown to the person.
  createdAt: v.number(),
  // When the row reached the inbox: later than `createdAt` when the fan-out was deferred.
  deliveredAt: v.number(),
});

// `pending` waits for its time, `sending` has read its text and left: only the first is one a refreshed notification can still ride.
const notificationDeliveryStatusValidator = v.union(
  v.literal('pending'),
  v.literal('sending'),
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

/** A person's choice for one external channel; `target` is what the channel reaches them at, ciphertext when the channel says it is a secret, and `hint` the part of it their page may show. */
const notificationChannelChoiceValidator = v.object({
  enabled: v.boolean(),
  target: v.optional(v.string()),
  hint: v.optional(v.string()),
});
export type NotificationChannelChoice = Infer<typeof notificationChannelChoiceValidator>;

/** The choice as a person sends it: a target given replaces theirs, `null` takes it back, absent keeps it. */
export const notificationChannelChoiceArg = v.object({
  enabled: v.boolean(),
  target: v.optional(v.union(v.string(), v.null())),
});
export type NotificationChannelChoiceArg = Infer<typeof notificationChannelChoiceArg>;

/** What an external message may say: `full` is the notification as the inbox shows it, `none` its kind and its link, without the record's name. */
export const notificationNamesValidator = v.union(v.literal('full'), v.literal('none'));
export type NotificationNames = Infer<typeof notificationNamesValidator>;

/** What an administrator sets once for a plugin's channel, on the plugin's settings page. */
export const notificationChannelSettingsValidator = v.object({
  names: v.optional(notificationNamesValidator),
});

/** A Slack incoming webhook, the only address the Slack channel writes to. */
export const slackWebhookSchema = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/,
    'Collez l’URL d’un webhook entrant Slack, de la forme https://hooks.slack.com/services/…',
  );

/** The rule of each channel's target, by channel key: the page checks with the one the mutation applies. */
export const NOTIFICATION_TARGET_SCHEMAS: Record<string, z.ZodType<string>> = {
  slack: slackWebhookSchema,
};

/** One row per person: the kinds they turned on or off (absent = the catalogue's default) and the channels they chose (absent = off). */
export const notificationPreferencesValidator = v.object({
  userId: v.id('users'),
  kinds: v.record(v.string(), v.boolean()),
  channels: v.record(v.string(), notificationChannelChoiceValidator),
  updatedAt: v.number(),
});

/** The one pending fan-out run, so that mutations writing facts at once queue one run, not one each. */
export const notificationFanOutValidator = v.object({
  scheduledFnId: v.id('_scheduled_functions'),
});

/** The fan-out drains this many events per run; a run that drained a full batch schedules the next. */
export const NOTIFICATION_FAN_OUT_BATCH = 50;
/** The unread count is read up to here and shown as « 99+ » past 99. */
export const NOTIFICATION_UNREAD_CAP = 100;
/** The popover shows the latest this many. */
export const NOTIFICATION_LATEST = 20;
/** A delivery waits this long before it leaves: a record changed twice in the minute is one message, carrying where it is now. */
export const NOTIFICATION_DELIVERY_HOLD_MS = 60_000;
/** A delivery still sending after this long was interrupted: an action lives ten minutes at most. */
export const NOTIFICATION_DELIVERY_TIMEOUT_MS = 15 * 60_000;
/** A delivery that failed is tried again after each of these, then given up. */
export const NOTIFICATION_DELIVERY_BACKOFF_MS = [1, 5, 15, 60].map((minutes) => minutes * 60_000);
