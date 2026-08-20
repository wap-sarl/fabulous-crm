'use node';

/**
 * SMTP email transport (nodemailer). NODE-ONLY — this is the single module that
 * imports nodemailer, so it must never be re-exported from the lib barrel
 * (index.ts) or imported from a default-runtime module (auth.ts, http.ts,
 * emailUtils.ts). Only 'use node' action files may import it. Mirrors
 * `sendBrevoEmail`'s never-throws `{ ok, status, error?, messageId? }` contract.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailSender, SmtpSettings } from './emailProvider';

/**
 * Build a pooled nodemailer transporter. `pool: true` reuses connections across
 * the (up to 50) sends in a campaign batch instead of one handshake per message.
 * Auth omits `auth` when no user is set (open relay / IP-authenticated relay).
 */
export function createSmtpTransport(smtp: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    pool: true,
  });
}

/**
 * Send one email through a nodemailer transporter. Returns the same shape as
 * `sendBrevoEmail` so callers can treat both providers uniformly. The returned
 * `messageId` is nodemailer's synthetic id — there is no delivery/open webhook
 * to correlate it, which is the expected degradation under SMTP.
 */
export async function sendSmtpEmail(
  transport: Transporter,
  sender: EmailSender,
  {
    to,
    subject,
    htmlContent,
    attachment,
  }: {
    to: { email: string; name?: string }[];
    subject: string;
    htmlContent: string;
    attachment?: { name: string; content: string }; // content = base64
  }
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  try {
    const info = await transport.sendMail({
      from: { name: sender.name, address: sender.email },
      to: to.map((t) => (t.name ? { name: t.name, address: t.email } : t.email)),
      subject,
      html: htmlContent,
      ...(attachment
        ? { attachments: [{ filename: attachment.name, content: attachment.content, encoding: 'base64' }] }
        : {}),
    });
    return { ok: true, status: 200, messageId: info.messageId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('SMTP send error:', error);
    return { ok: false, status: 0, error };
  }
}
