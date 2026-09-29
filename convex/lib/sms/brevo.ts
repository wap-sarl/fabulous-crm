import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { MessageType } from '../../schema';

/** The sender shown on every outgoing SMS: an alphanumeric ID of 11 characters at most. */
const SMS_SENDER = process.env.BREVO_SMS_SENDER || 'CRM';

/** Brevo wants the E.164 number without its leading `+`; a CSV import can store a national format, hence FR as the default region. */
export function toBrevoRecipient(phone: string | undefined): string | null {
  if (!phone) return null;
  const parsed = parsePhoneNumberFromString(phone, 'FR');
  if (!parsed?.isValid()) return null;
  return parsed.number.replace(/^\+/, '');
}

/** Never throws, as `sendBrevoEmail`: a failure is logged and returned, a success carries Brevo's messageId for tracking. */
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
