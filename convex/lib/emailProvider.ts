/** Imported from any runtime, so this must never import nodemailer, which is node-only: the SMTP transport lives in lib/smtpUtils.ts. */

import type { AppConfig } from '../_lib/validators/appConfig';
import { decryptSecret } from './crypto';

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

/** Accepts the full config document, with its `_id` and `_creationTime`, as well as the validator type. */
type ConfigLike = Pick<AppConfig, 'email' | 'senderEmail' | 'senderName'> | null | undefined;

/** A stored secret in clear, or the env fallback; stored secrets are ciphertext (lib/crypto.ts). */
async function secret(stored: string | undefined, fallback: string | undefined): Promise<string> {
  return stored ? await decryptSecret(stored) : fallback || '';
}

/** Resolve the `From` identity: config sender → env → hard default. */
function resolveSender(cfg: ConfigLike): EmailSender {
  return {
    name: cfg?.senderName || process.env.EMAIL_SENDER_NAME || 'CRM',
    email: cfg?.senderEmail || process.env.EMAIL_SENDER_EMAIL || 'noreply@example.com',
  };
}

/** Brevo when `email` is unset; the Brevo key falls back to its env var, so a deployment keeps sending before the settings screen is filled in. */
export async function resolveEmailProvider(cfg: ConfigLike): Promise<ResolvedEmailProvider> {
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
        pass: await secret(email.smtpPass, undefined),
      },
      sender,
    };
  }

  return {
    kind: 'brevo',
    apiKey: await secret(email?.brevoApiKey, process.env.BREVO_API_KEY),
    sender,
  };
}

/** What is configured, without decrypting anything: for queries that only show presence flags. */
export function emailPresence(cfg: ConfigLike): {
  hasBrevoApiKey: boolean;
  hasBrevoWebhookSecret: boolean;
  smsAvailable: boolean;
  emailConfigured: boolean;
} {
  const email = cfg?.email;
  const hasBrevoApiKey = !!(email?.brevoApiKey || process.env.BREVO_API_KEY);
  const smtpConfigured = email?.provider === 'smtp' && !!email.smtpHost;
  return {
    hasBrevoApiKey,
    hasBrevoWebhookSecret: !!(email?.brevoWebhookSecret || process.env.BREVO_WEBHOOK_SECRET),
    smsAvailable: hasBrevoApiKey,
    emailConfigured: email?.provider === 'smtp' ? smtpConfigured : hasBrevoApiKey,
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
export async function resolveBrevo(cfg: ConfigLike): Promise<ResolvedBrevo> {
  const email = cfg?.email;
  const apiKey = await secret(email?.brevoApiKey, process.env.BREVO_API_KEY);
  const webhookSecret = await secret(email?.brevoWebhookSecret, process.env.BREVO_WEBHOOK_SECRET);
  return {
    apiKey,
    webhookSecret,
    smsWebhookSecret: process.env.BREVO_SMS_WEBHOOK_SECRET || webhookSecret,
    smsSender: email?.brevoSmsSender || process.env.BREVO_SMS_SENDER || 'CRM',
    smsAvailable: apiKey.length > 0,
    emailIsBrevo: (email?.provider ?? 'brevo') === 'brevo',
  };
}
