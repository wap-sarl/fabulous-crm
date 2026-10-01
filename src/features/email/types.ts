import type { api } from '@crm/lib/backend';
import type { FunctionReturnType } from 'convex/server';

type Provider = 'brevo' | 'smtp';

/** Local edit state. Secret fields hold '' when unchanged (kept server-side). */
export type Draft = {
  senderEmail: string;
  senderName: string;
  provider: Provider;
  brevoApiKey: string;
  brevoWebhookSecret: string;
  brevoSmsSender: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
};

/** The stored e-mail settings as the admin config gives them: secrets are presence flags only. */
export type StoredEmailConfig = NonNullable<
  FunctionReturnType<typeof api.features.config.queries.getAdminConfig>
>['email'];

export type SetDraftField = <K extends keyof Draft>(key: K, value: Draft[K]) => void;
