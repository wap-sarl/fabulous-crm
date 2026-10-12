import { type Infer, v } from 'convex/values';
import { z } from 'zod';
import {
  consentSourceValidator,
  type LeadSubscription,
  marketingConsentChannelValidator,
  subscriptionStatusValidator,
} from './crm';
import { logsValidator } from './shared';

/** What lets the organisation write to a subscriber: a consent given, or a legitimate interest the person may object to. */
export const legalBasisValidator = v.union(v.literal('consent'), v.literal('legitimate_interest'));

/** A topic a contact subscribes to on one channel; the subscriber's choice lives on the lead. */
export const subscriptionTypeValidator = v.object({
  ...logsValidator.fields,
  name: v.string(),
  description: v.optional(v.string()),
  channel: marketingConsentChannelValidator,
  active: v.boolean(),
  legalBasis: legalBasisValidator,
  order: v.number(),
});

/** One change of consent, on a type or on a channel, kept for good: the proof of when and how it was collected. */
export const consentEventValidator = v.object({
  leadId: v.id('leads'),
  at: v.number(),
  typeId: v.optional(v.id('subscriptionTypes')),
  channel: v.optional(marketingConsentChannelValidator),
  from: subscriptionStatusValidator,
  to: subscriptionStatusValidator,
  source: consentSourceValidator,
  // The client address of the person's own click, keyed as the forms key it; none for a change made elsewhere.
  ipHash: v.optional(v.string()),
});

export type LegalBasis = Infer<typeof legalBasisValidator>;
export type SubscriptionType = Infer<typeof subscriptionTypeValidator>;

export const subscriptionNameSchema = z.string().trim().min(1).max(80);
export const subscriptionDescriptionSchema = z.string().trim().max(500);

/** Shipped at setup and offered again when the list is empty, all under consent: whether a legitimate interest applies (existing customers, similar offers) is the tenant's to say. */
export const DEFAULT_SUBSCRIPTION_TYPES: ReadonlyArray<
  Pick<SubscriptionType, 'name' | 'description' | 'channel' | 'legalBasis'>
> = [
  {
    name: 'Newsletter',
    description: 'Nos actualités et conseils, une fois par mois environ.',
    channel: 'email',
    legalBasis: 'consent',
  },
  {
    name: 'Informations produit',
    description: 'Les nouveautés et évolutions de nos offres.',
    channel: 'email',
    legalBasis: 'consent',
  },
  {
    name: 'Invitations',
    description: 'Nos événements, webinaires et rencontres.',
    channel: 'email',
    legalBasis: 'consent',
  },
];

type Subscriber = {
  marketingConsent: Infer<typeof marketingConsentChannelValidator>[];
  subscriptions?: LeadSubscription[];
};
type TypeRef = {
  _id: LeadSubscription['typeId'];
  channel: SubscriptionType['channel'];
  legalBasis: LegalBasis;
};

/** Whether a contact is in on a type. Nothing without the channel's consent, whatever the basis: a channel refused covers every type of it, the ones made later too. With it, their explicit choice; without one, a `consent` type is out (a consent is given per topic) and a `legitimate_interest` type is in until they object. */
export function isSubscribed(lead: Subscriber, type: TypeRef): boolean {
  if (!lead.marketingConsent.includes(type.channel)) return false;
  const own = lead.subscriptions?.find((s) => s.typeId === type._id);
  if (own) return own.status === 'in';
  return type.legalBasis === 'legitimate_interest';
}

/** The ids of the given types the contact is in on. */
export function subscribedTypeIds(lead: Subscriber, types: TypeRef[]): string[] {
  return types.filter((type) => isSubscribed(lead, type)).map((type) => type._id);
}
