'use node';

/** NODE-ONLY (nodemailer): callers hand over a resolved provider and stay blind to Brevo versus SMTP; neither path ever throws. */

import { type ResolvedEmailProvider, sendBrevoEmail } from '../../lib';
import { createSmtpTransport, sendSmtpEmail } from '../../lib/smtpUtils';

export type EmailMessage = {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  attachment?: { name: string; content: string }; // content = base64
};

export type EmailSendResult = {
  ok: boolean;
  status: number;
  error?: string;
  messageId?: string;
};

/** For SMTP it holds a pooled transporter: build it once per campaign batch and `close` it after; for Brevo `close` does nothing. */
export type EmailDispatcher = {
  send: (msg: EmailMessage) => Promise<EmailSendResult>;
  close: () => void;
};

export function createEmailDispatcher(provider: ResolvedEmailProvider): EmailDispatcher {
  if (provider.kind === 'brevo') {
    return {
      send: (msg) => sendBrevoEmail(provider.apiKey, { ...msg, sender: provider.sender }),
      close: () => {},
    };
  }
  const transport = createSmtpTransport(provider.smtp);
  return {
    send: (msg) => sendSmtpEmail(transport, provider.sender, msg),
    close: () => transport.close(),
  };
}

/** One-shot send (single transactional email, e.g. auth sign-in). */
export async function sendEmail(
  provider: ResolvedEmailProvider,
  msg: EmailMessage,
): Promise<EmailSendResult> {
  const dispatcher = createEmailDispatcher(provider);
  try {
    return await dispatcher.send(msg);
  } finally {
    dispatcher.close();
  }
}
