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
  assignedTo: v.optional(v.id('users')),
  companyId: v.optional(v.id('companies')),

  isRedFlagged: v.boolean(),

  lifecycleStage: v.optional(v.string()),

  // Denormalized, normalized identity text (first/last name, email, phone,
  // company name) serving the by_searchText search index. Stamped by the
  // Triggers wrapper (_lib/functions.ts) on every write — never write it by hand.
  searchText: v.optional(v.string()),
  dedupe: v.optional(leadDedupeValidator),

  // Admin-defined custom property values, keyed by propertyDefinitions._id.
  // Optional so leads written before any property existed stay valid.
  customProperties: customPropertiesValidator,
});

export type Lead = Infer<typeof leadValidator>;
export type MarketingConsentChannel = Infer<typeof marketingConsentChannelValidator>;
export type ConsentSource = Infer<typeof consentSourceValidator>;

export const campaignStatusValidator = v.union(
  v.literal('draft'),
  // Recipients are being resolved and campaignSends materialized in scheduled
  // batches (prepareCampaignBatch). Flips to 'sending' when preparation ends.
  v.literal('preparing'),
  v.literal('sending'),
  v.literal('sent'),
  v.literal('failed'),
);

/** Channel a campaign targets. Absent on legacy rows = email. */
export const campaignChannelValidator = v.union(v.literal('email'), v.literal('sms'));

/**
 * Campaign message category (both channels). 'marketing' drives consent gating
 * of recipients; for SMS it is also passed to Brevo as the transactional-SMS
 * `type` (marketing applies Brevo's opt-out/quiet-hours rules).
 */
export const messageTypeValidator = v.union(v.literal('marketing'), v.literal('transactional'));

/**
 * Built-in lead fields a tracked link may update on click. Deliberately
 * excluded: `marketingConsent` (consent changes only via the dedicated consent
 * link — same rule as updateLead), `assignedTo` (a users id, not authorable in
 * the composer) and `address` (composite object).
 */
export const trackedLinkStandardFieldValidator = v.union(
  v.literal('firstName'),
  v.literal('lastName'),
  v.literal('email'),
  v.literal('phone'),
  v.literal('comment'),
  v.literal('isRedFlagged'),
);

export type TrackedLinkStandardField = Infer<typeof trackedLinkStandardFieldValidator>;

/**
 * A tracked link defined on a campaign. Each recipient gets a unique URL
 * (campaignLinkTokens); clicking it sets `value` on the lead property named by
 * `target` — a built-in column or a custom-property definition (same
 * standard/custom split as the lead filters) — then 302-redirects to
 * `redirectUrl` (or shows a French "you can close this tab" page when unset).
 * `key` is the placeholder param name ({{ params.<key> }}) — word chars only,
 * unique within the campaign.
 */
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
  // Brevo transactional template id. Present for template-mode email campaigns;
  // absent for custom-HTML (WYSIWYG) email and for SMS campaigns.
  brevoTemplateId: v.optional(v.number()),
  // Custom email (WYSIWYG) content. Present when the email body is authored in
  // the CRM instead of a Brevo template. Placeholders ({{ params.x }}) are
  // substituted per recipient at send time.
  subject: v.optional(v.string()),
  htmlBody: v.optional(v.string()),
  // SMS message text. Sent via Brevo for SMS campaigns. Placeholders
  // ({{ params.x }}) are substituted per recipient at send time (plain text).
  smsBody: v.optional(v.string()),
  // Marketing vs transactional category. Absent on legacy rows = marketing.
  messageType: v.optional(messageTypeValidator),
  // Chosen channel. Optional so pre-channel campaigns still validate (= email).
  channel: v.optional(campaignChannelValidator),
  // Tracked links authored in the composer (snapshot, like subject/htmlBody).
  trackedLinks: v.optional(v.array(campaignTrackedLinkValidator)),
  // Email provider snapshot, stamped at send time so the detail view can label
  // analytics correctly even after an admin later switches providers. Absent on
  // legacy rows and on SMS campaigns = Brevo (the only provider that existed).
  emailProvider: v.optional(v.union(v.literal('brevo'), v.literal('smtp'))),
  status: campaignStatusValidator,
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
  // Normalized Brevo recipient (international, no `+`) for SMS sends — matches the
  // `to` field of Brevo SMS webhook events, so an inbound STOP can be correlated
  // back to the lead by phone. Absent for email sends. See `by_smsRecipient`.
  smsRecipient: v.optional(v.string()),
  // Placeholder values substituted into the message ({{ params.x }}).
  params: v.record(v.string(), v.string()),
  status: campaignSendStatusValidator,
  brevoMessageId: v.optional(v.string()),
  error: v.optional(v.string()),
  sentAt: v.optional(v.number()),
  // First time the recipient opened the email (Brevo webhook).
  openedAt: v.optional(v.number()),
  // First time the recipient clicked any link in the message — a tracked
  // /l/<token> link or, for email, any URL reported by Brevo click tracking.
  clickedAt: v.optional(v.number()),
  // SMS lifecycle markers (first-only), stamped from Brevo SMS webhook events.
  // `sentAt` above = accepted by Brevo; `deliveredAt` = reached the handset.
  deliveredAt: v.optional(v.number()),
  repliedAt: v.optional(v.number()),
  unsubscribedAt: v.optional(v.number()),
  bouncedAt: v.optional(v.number()),
});

export type CampaignSend = Infer<typeof campaignSendValidator>;
export type CampaignSendStatus = Infer<typeof campaignSendStatusValidator>;

/**
 * Kinds of campaign delivery/engagement events (campaignEvents rows). Mostly
 * Brevo transactional-email webhook events, plus our own signals:
 * - 'link_click' — a per-recipient tracked link (/l/<token>) was followed;
 *   distinct from Brevo's 'clicked' so both can coexist when Brevo click
 *   tracking rewrites the same URLs.
 * - 'sms_reply' — the lead replied to a marketing SMS (Brevo SMS webhook).
 */
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

/**
 * One delivery/engagement event on a campaign send. Append-only log written by
 * the Brevo webhooks (email + SMS) and the tracked-link redirect; every
 * occurrence is kept (repeat opens/clicks included), unlike the first-only
 * `openedAt`/`clickedAt` stamps on the send.
 */
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

/**
 * Per-recipient secret behind a tracked link ({@link campaignTrackedLinkValidator}).
 * One row per (pending send × tracked link); resolved O(1) by the public
 * GET /l/<token> HTTP route via the `by_token` index. `clickedAt` is stamped on
 * first click only (idempotent).
 */
export const campaignLinkTokenValidator = v.object({
  token: v.string(),
  campaignId: v.id('campaigns'),
  sendId: v.id('campaignSends'),
  leadId: v.id('leads'),
  // `key` of the campaign's tracked link this token belongs to.
  linkKey: v.string(),
  clickedAt: v.optional(v.number()),
});

export type CampaignLinkToken = Infer<typeof campaignLinkTokenValidator>;

/**
 * A free-text note attached to a lead. Unlike the lead's single `comment`
 * field, a lead can have many notes; pinned ones are surfaced first in the UI.
 * `createdBy` (from logsValidator) is the author; `_creationTime` is the
 * created timestamp.
 */
export const leadNoteValidator = v.object({
  ...logsValidator.fields,
  ...softDeleteValidator.fields,
  leadId: v.id('leads'),
  content: v.string(),
  isPinned: v.boolean(),
});

export type LeadNote = Infer<typeof leadNoteValidator>;
