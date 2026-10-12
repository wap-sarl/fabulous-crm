import { z } from 'zod';
import { subscriptionDescriptionSchema, subscriptionNameSchema } from '@crm/lib/backend';

/** The dialog's fields; the channel and the legal basis are set at creation only. */
export const subscriptionTypeFormSchema = z.object({
  name: subscriptionNameSchema,
  description: subscriptionDescriptionSchema,
  channel: z.enum(['email', 'sms', 'telephone_canvassing', 'postal']),
  legalBasis: z.enum(['consent', 'legitimate_interest']),
  active: z.boolean(),
});

export type SubscriptionTypeForm = z.infer<typeof subscriptionTypeFormSchema>;
