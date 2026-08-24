/**
 * Pure resolvers that turn the singleton `appConfig.email` sub-object (or its
 * absence) into the concrete credentials the send paths need, falling back to
 * the legacy env vars when a value is unset. Deterministic and side-effect-free
 * (no DB, no network) so it is safe to import from any runtime — crucially it
 * must NOT import nodemailer, which is node-only. The SMTP transport itself
 * lives in convex/lib/smtpUtils.ts ('use node').
 */

import type { AppConfig } from '../_lib/validators/appConfig';

/** Sender identity used as the `From` for every outgoing email. */
export type EmailSender = { name: string; email: string };

/** SMTP connection settings for nodemailer. */
export type SmtpSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

/** The active email provider, fully resolved with credentials + sender. */
export type ResolvedEmailProvider =
  | { kind: 'brevo'; apiKey: string; sender: EmailSender }
  | { kind: 'smtp'; smtp: SmtpSettings; sender: EmailSender };

/**
 * `appConfig.email` as seen by a resolver. Accepts the full config doc (which
 * carries extra `_id`/`_creationTime` fields) as well as the validator type.
 */
type ConfigLike = Pick<AppConfig, 'email' | 'senderEmail' | 'senderName'> | null | undefined;

/** Resolve the `From` identity: config sender → env → hard default. */
function resolveSender(cfg: ConfigLike): EmailSender {
  return {
    name: cfg?.senderName || process.env.EMAIL_SENDER_NAME || 'CRM',
    email: cfg?.senderEmail || process.env.EMAIL_SENDER_EMAIL || 'noreply@example.com',
  };
}

/**
 * Resolve which provider sends outbound email and its credentials. Defaults to
 * Brevo (the only historical provider) when `email` is unset. Brevo API key and
 * SMTP fields fall back to their env vars so a deployment keeps working before
 * the settings screen is filled in.
 */
export function resolveEmailProvider(cfg: ConfigLike): ResolvedEmailProvider {
  const email = cfg?.email;
  const sender = resolveSender(cfg);

  if (email?.provider === 'smtp') {
    return {
      kind: 'smtp',
      smtp: {
        host: email.smtpHost ?? '',
        port: email.smtpPort ?? 587,
        secure: email.smtpSecure ?? false,
        user: email.smtpUser ?? '',
        pass: email.smtpPass ?? '',
      },
      sender,
    };
  }

  return {
    kind: 'brevo',
    apiKey: email?.brevoApiKey || process.env.BREVO_API_KEY || '',
    sender,
  };
}

/** True when the resolved email provider has the credentials it needs to send. */
export function isEmailProviderConfigured(p: ResolvedEmailProvider): boolean {
  return p.kind === 'brevo' ? p.apiKey.length > 0 : p.smtp.host.length > 0;
}

/** Brevo credentials — power SMS (any email provider) and email webhooks. */
export type ResolvedBrevo = {
  apiKey: string;
  webhookSecret: string;
  smsWebhookSecret: string;
  smsSender: string;
  /** SMS can be sent iff a Brevo API key is configured (decoupled from email). */
  smsAvailable: boolean;
  /** True when outbound email also goes through Brevo (gates email webhooks). */
  emailIsBrevo: boolean;
};

/** Resolve Brevo credentials with env fallback, independent of email provider. */
export function resolveBrevo(cfg: ConfigLike): ResolvedBrevo {
  const email = cfg?.email;
  const apiKey = email?.brevoApiKey || process.env.BREVO_API_KEY || '';
  const webhookSecret = email?.brevoWebhookSecret || process.env.BREVO_WEBHOOK_SECRET || '';
  return {
    apiKey,
    webhookSecret,
    smsWebhookSecret: process.env.BREVO_SMS_WEBHOOK_SECRET || webhookSecret,
    smsSender: email?.brevoSmsSender || process.env.BREVO_SMS_SENDER || 'CRM',
    smsAvailable: apiKey.length > 0,
    emailIsBrevo: (email?.provider ?? 'brevo') === 'brevo',
  };
}
