import { type Infer, v } from 'convex/values';
import {
  addressValidator,
  firstAndLastNameValidator,
  logsValidator,
  softDeleteValidator,
} from './shared';
import { customPropertiesValidator, propertyValueValidator } from './properties';
import { leadDedupeValidator } from './duplicates';

/** Marketing consent channels a lead can opt into. */
export const marketingConsentChannelValidator = v.union(
  v.literal('email'),
  v.literal('sms'),
  v.literal('telephone_canvassing'),
  v.literal('postal'),
);

/** Where a consent change came from. */
export const consentSourceValidator = v.union(
  v.literal('crm'),
  v.literal('public_link'),
  v.literal('import'),
  // Brevo SMS webhook: the lead replied STOP to a marketing SMS.
  v.literal('sms_stop'),
  // The lead checked the GDPR box of a public capture form.
  v.literal('form'),
);

export const leadValidator = v.object({
  ...firstAndLastNameValidator.fields,
  ...logsValidator.fields,
  ...softDeleteValidator.fields,

  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(addressValidator),

  marketingConsent: v.array(marketingConsentChannelValidator),
  consentUpdatedAt: v.optional(v.number()),
  consentSource: v.optional(consentSourceValidator),
  // Persistent per-lead secret embedded in every marketing email's consent link.
  consentToken: v.string(),

  comment: v.optional(v.string()),
  ownerIds: v.array(v.id('users')),
  companyId: v.optional(v.id('companies')),

  isRedFlagged: v.boolean(),
  // Right to object (RGPD): no score, no behavioural counters, the contact itself untouched.
  excludeFromProfiling: v.optional(v.boolean()),

  lifecycleStage: v.optional(v.string()),

  lastActivityAt: v.optional(v.number()),
  lastEmailOpenAt: v.optional(v.number()),
  emailOpenCount: v.optional(v.number()),
  lastEmailClickAt: v.optional(v.number()),
  emailClickCount: v.optional(v.number()),
  lastFormSubmissionAt: v.optional(v.number()),
  formSubmissionCount: v.optional(v.number()),
  lastPageViewAt: v.optional(v.number()),
  pageViewCount: v.optional(v.number()),
  // The last distinct paths the contact's browser visited, most recent last (validators/tracking.ts), for filters.
  visitedPages: v.optional(v.array(v.string())),
  leadScore: v.optional(v.number()),
  scoreBreakdown: v.optional(v.record(v.string(), v.number())),

  // Feeds the by_searchText index; the Triggers wrapper (_lib/functions.ts) stamps it on every write: never write it by hand.
  searchText: v.optional(v.string()),
  dedupe: v.optional(leadDedupeValidator),

  // Keyed by propertyDefinitions._id; optional so leads written before any property existed stay valid.
  customProperties: customPropertiesValidator,
});

export type Lead = Infer<typeof leadValidator>;
export type MarketingConsentChannel = Infer<typeof marketingConsentChannelValidator>;
export type ConsentSource = Infer<typeof consentSourceValidator>;

export const campaignStatusValidator = v.union(
  v.literal('draft'),
  // The campaignSends are being materialized in scheduled batches (prepareCampaignBatch); 'sending' follows.
  v.literal('preparing'),
  v.literal('sending'),
  v.literal('sent'),
  v.literal('failed'),
);

/** Channel a campaign targets. Absent on legacy rows = email. */
export const campaignChannelValidator = v.union(v.literal('email'), v.literal('sms'));

/** 'marketing' gates the recipients on consent; for SMS it is also Brevo's `type`, which applies its opt-out and quiet-hours rules. */
export const messageTypeValidator = v.union(v.literal('marketing'), v.literal('transactional'));

/** Left out on purpose: `marketingConsent` (consent changes only through the consent link), `assignedTo` (a users id, not authorable in the composer) and `address` (composite). */
export const trackedLinkStandardFieldValidator = v.union(
  v.literal('firstName'),
  v.literal('lastName'),
  v.literal('email'),
  v.literal('phone'),
  v.literal('comment'),
  v.literal('isRedFlagged'),
);

export type TrackedLinkStandardField = Infer<typeof trackedLinkStandardFieldValidator>;

/** A click sets `value` on the lead property `target` names, then redirects or shows a closing page; `key` is the placeholder name, unique within the campaign. */
export const campaignTrackedLinkValidator = v.object({
  key: v.string(),
  label: v.string(),
  target: v.union(
    v.object({ kind: v.literal('standard'), field: trackedLinkStandardFieldValidator }),
    v.object({ kind: v.literal('custom'), propertyDefId: v.id('propertyDefinitions') }),
  ),
  value: propertyValueValidator,
  redirectUrl: v.optional(v.string()),
});

export type CampaignTrackedLink = Infer<typeof campaignTrackedLinkValidator>;

export const campaignValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  name: v.string(),
  // Set only for an email campaign sent from a Brevo template.
  brevoTemplateId: v.optional(v.number()),
  // Set when the email is authored in the CRM; the {{ params.x }} placeholders are substituted per recipient at send time.
  subject: v.optional(v.string()),
  htmlBody: v.optional(v.string()),
  // Plain text; the {{ params.x }} placeholders are substituted per recipient at send time.
  smsBody: v.optional(v.string()),
  // Marketing vs transactional category. Absent on legacy rows = marketing.
  messageType: v.optional(messageTypeValidator),
  // Chosen channel. Optional so pre-channel campaigns still validate (= email).
  channel: v.optional(campaignChannelValidator),
  // Tracked links authored in the composer (snapshot, like subject/htmlBody).
  trackedLinks: v.optional(v.array(campaignTrackedLinkValidator)),
  // Stamped at send time so the analytics stay labelled right after a provider switch; absent means Brevo.
  emailProvider: v.optional(v.union(v.literal('brevo'), v.literal('smtp'))),
  status: campaignStatusValidator,
  // Code of the refusal that failed the campaign during preparation (extensions), if any.
  failureReason: v.optional(v.string()),
  totalCount: v.number(),
  sentCount: v.number(),
  failedCount: v.number(),
});

export type Campaign = Infer<typeof campaignValidator>;
export type CampaignStatus = Infer<typeof campaignStatusValidator>;
export type CampaignChannel = Infer<typeof campaignChannelValidator>;
export type MessageType = Infer<typeof messageTypeValidator>;

export const campaignSendStatusValidator = v.union(
  v.literal('pending'),
  v.literal('sent'),
  v.literal('failed'),
  v.literal('skipped_no_email'),
  v.literal('skipped_no_phone'),
);

export const campaignSendValidator = v.object({
  campaignId: v.id('campaigns'),
  leadId: v.id('leads'),
  email: v.optional(v.string()),
  // Recipient phone (E.164-ish) for SMS campaigns; absent for email sends.
  phone: v.optional(v.string()),
  // International, no `+`: the `to` of Brevo's SMS webhook events, so an inbound STOP finds its lead (`by_smsRecipient`).
  smsRecipient: v.optional(v.string()),
  // Placeholder values substituted into the message ({{ params.x }}).
  params: v.record(v.string(), v.string()),
  status: campaignSendStatusValidator,
  brevoMessageId: v.optional(v.string()),
  error: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  // First time the recipient opened the email (Brevo webhook).
  openedAt: v.optional(v.number()),
  // First click on any link: a tracked /l/<token> link or, for email, any URL Brevo's click tracking reports.
  clickedAt: v.optional(v.number()),
  // First-only stamps from Brevo's SMS webhook: `sentAt` above means accepted by Brevo, `deliveredAt` reached the handset.
  deliveredAt: v.optional(v.number()),
  repliedAt: v.optional(v.number()),
  unsubscribedAt: v.optional(v.number()),
  bouncedAt: v.optional(v.number()),
});

export type CampaignSend = Infer<typeof campaignSendValidator>;
export type CampaignSendStatus = Infer<typeof campaignSendStatusValidator>;

/** Brevo's webhook events plus our own; 'link_click' is kept apart from Brevo's 'clicked' so both coexist when Brevo's click tracking rewrites the same URLs. */
export const campaignEventTypeValidator = v.union(
  v.literal('delivered'),
  v.literal('opened'),
  // Brevo click tracking: any URL in the email.
  v.literal('clicked'),
  // Our per-recipient /l/<token> tracked links.
  v.literal('link_click'),
  v.literal('hard_bounce'),
  v.literal('soft_bounce'),
  v.literal('spam'),
  v.literal('unsubscribed'),
  v.literal('blocked'),
  v.literal('invalid'),
  v.literal('error'),
  // SMS 'replied' webhook status.
  v.literal('sms_reply'),
);

/** An append-only log: every occurrence is kept, repeat opens and clicks included, unlike the first-only `openedAt`/`clickedAt` stamps on the send. */
export const campaignEventValidator = v.object({
  campaignId: v.id('campaigns'),
  sendId: v.id('campaignSends'),
  leadId: v.id('leads'),
  type: campaignEventTypeValidator,
  // Brevo's event timestamp (ts_epoch, ms) when provided, else our receive time.
  eventAt: v.number(),
  // 'clicked': the clicked URL as reported by Brevo.
  url: v.optional(v.string()),
  // 'link_click': key/label of the campaign tracked link.
  linkKey: v.optional(v.string()),
  linkLabel: v.optional(v.string()),
  // Bounces/blocked/error: Brevo's reason string.
  reason: v.optional(v.string()),
});

export type CampaignEvent = Infer<typeof campaignEventValidator>;
export type CampaignEventType = Infer<typeof campaignEventTypeValidator>;

/** The per-recipient secret behind a tracked link, one row per send and link; the public GET /l/<token> route resolves it by `by_token`, and `clickedAt` is stamped on the first click only. */
export const campaignLinkTokenValidator = v.object({
  token: v.string(),
  campaignId: v.id('campaigns'),
  sendId: v.id('campaignSends'),
  leadId: v.id('leads'),
  // `key` of the campaign's tracked link this token belongs to.
  linkKey: v.string(),
  clickedAt: v.optional(v.number()),
  // Named tracking: the hash of the one-time value the last click put in the landing URL, and until when it holds.
  identifyHash: v.optional(v.string()),
  identifyUntil: v.optional(v.number()),
});

export type CampaignLinkToken = Infer<typeof campaignLinkTokenValidator>;

/** A lead has many notes, unlike its single `comment`; `createdBy` is the author and the pinned ones come first in the UI. */
export const leadNoteValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  leadId: v.id('leads'),
  content: v.string(),
  isPinned: v.boolean(),
});

export type LeadNote = Infer<typeof leadNoteValidator>;
