'use node';

/** Node only, as the single module importing nodemailer: never re-exported from the lib barrel, and imported by 'use node' action files alone. */

import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailSender, SmtpSettings } from './provider';

/** Pooled, so a campaign batch reuses connections instead of one handshake per message; no `auth` without a user, for a relay that is open or authenticated by IP. */
export function createSmtpTransport(smtp: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    pool: true,
  });
}

/** Never throws and answers as `sendBrevoEmail` does; the `messageId` is nodemailer's synthetic one, as SMTP has no delivery or open webhook to correlate. */
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
  },
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  try {
    const info = await transport.sendMail({
      from: { name: sender.name, address: sender.email },
      to: to.map((t) => (t.name ? { name: t.name, address: t.email } : t.email)),
      subject,
      html: htmlContent,
      ...(attachment
        ? {
            attachments: [
              { filename: attachment.name, content: attachment.content, encoding: 'base64' },
            ],
          }
        : {}),
    });
    return { ok: true, status: 200, messageId: info.messageId };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('SMTP send error:', error);
    return { ok: false, status: 0, error };
  }
}
