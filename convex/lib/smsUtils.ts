/**
 * Shared SMS utilities for Brevo transactional SMS sending. Mirrors
 * `emailUtils.ts`: a sender identity constant plus the Brevo HTTP helper used by
 * the campaign send action.
 */

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { MessageType } from '../schema';

/**
 * Sender identity (alphanumeric ID, max 11 chars) shown on every outgoing SMS.
 * Configure per deployment with `bunx convex env set BREVO_SMS_SENDER …`.
 */
export const SMS_SENDER = process.env.BREVO_SMS_SENDER || 'CRM';

/**
 * Normalize a stored lead phone to Brevo's recipient format: the E.164 number
 * with the country code but **without** the leading `+` (e.g. `33612345678`).
 * Leads are entered as E.164 via the phone input, but CSV import can store a
 * national format (`06…`), so parse defensively with FR as the default region.
 * Returns null when the value is missing or not a valid phone number.
 */
export function toBrevoRecipient(phone: string | undefined): string | null {
  if (!phone) return null;
  const parsed = parsePhoneNumberFromString(phone, 'FR');
  if (!parsed?.isValid()) return null;
  return parsed.number.replace(/^\+/, '');
}

/**
 * Send a single SMS via the Brevo transactional SMS API. Same never-throws
 * contract as `sendBrevoEmail`: returns `{ ok, status, error?, messageId? }`
 * and logs on failure. Returns Brevo's messageId on success for tracking.
 */
export async function sendBrevoSms(
  apiKey: string,
  {
    recipient,
    content,
    type,
    sender,
    webUrl,
  }: {
    recipient: string;
    content: string;
    type: MessageType;
    /** Overrides the env-derived SMS_SENDER. */
    sender?: string;
    /** Webhook Brevo calls for each event on this message (delivered, unsubscribed…). */
    webUrl?: string;
  },
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  const response = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({
      sender: sender ?? SMS_SENDER,
      recipient,
      content,
      type,
      ...(webUrl ? { webUrl } : {}),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Brevo SMS API error:', response.status, errorBody);
    return { ok: false, status: response.status, error: errorBody };
  }

  const data = (await response.json().catch(() => ({}))) as { messageId?: number | string };
  return {
    ok: true,
    status: response.status,
    messageId: data.messageId !== undefined ? String(data.messageId) : undefined,
  };
}
