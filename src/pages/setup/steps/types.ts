import type { Id } from '@crm/lib/backend';
import {
  MAX_SSO_PROVIDER_ID_LENGTH,
  ssoProviderIdOf,
  ssoProviderIdSchema,
  follows,
  httpUrlSchema,
} from '@crm/lib/backend';

/** Draft custom SSO provider as edited in the wizard (scopes as a string field). */
export type SsoDraft = {
  providerId: string; // stable slug — the OAuth callback path segment
  label: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string; // space/comma separated in the UI
  enabled: boolean;
};

/** Draft for a well-known social provider (Google, Microsoft, GitHub, LinkedIn). */
export type SocialDraft = {
  id: string; // Better Auth provider key, e.g. 'google'
  label: string;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
};

export type WizardData = {
  setupToken: string;
  organizationName: string;
  appUrl: string;
  senderEmail: string;
  senderName: string;
  magicLinkEnabled: boolean;
  ssoProviders: SsoDraft[];
  socialProviders: SocialDraft[];
  admin: { email: string; firstName: string; lastName: string };
  // The storage ids go to `completeSetup`; the preview URLs are transient object URLs, for display in the wizard only.
  logoStorageId?: Id<'_storage'>;
  logoPreviewUrl?: string;
  faviconStorageId?: Id<'_storage'>;
  faviconPreviewUrl?: string;
  /** Brand accent color (`#rrggbb`); sent to `completeSetup` when set. */
  primaryColor?: string;
};

export type StepProps = {
  data: WizardData;
  update: (patch: Partial<WizardData>) => void;
  error: string | null;
};

export function emptySsoProvider(): SsoDraft {
  return {
    providerId: '',
    label: '',
    issuerUrl: '',
    clientId: '',
    clientSecret: '',
    scopes: 'openid email profile',
    enabled: true,
  };
}

/** Convert a social draft into the backend `socialProviderConfig` shape. */
export function socialDraftToConfig(d: SocialDraft) {
  return {
    id: d.id,
    clientId: d.clientId.trim(),
    clientSecret: d.clientSecret,
    enabled: d.enabled,
  };
}

/** Convert a draft into the backend SSO provider shape. */
export function ssoDraftToConfig(d: SsoDraft) {
  return {
    providerId: d.providerId.trim(),
    label: d.label.trim(),
    issuerUrl: d.issuerUrl.trim().replace(/\/+$/, ''),
    clientId: d.clientId.trim(),
    clientSecret: d.clientSecret,
    scopes: d.scopes
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
    enabled: d.enabled,
  };
}

const ID_RULE = `lettres minuscules et chiffres, séparés par des tirets, ${MAX_SSO_PROVIDER_ID_LENGTH} caractères au plus`;

/** The sentences of what `completeSetup` refuses. */
export const SETUP_ERRORS: Record<string, string> = {
  invalid_setup_token: 'Jeton invalide.',
  sso_provider_invalid_id: `Identifiant (slug) de fournisseur SSO invalide : ${ID_RULE}.`,
  sso_provider_duplicate_id: 'Les identifiants (slug) des fournisseurs SSO doivent être uniques.',
};

/** The label as typed, and the id with it: the id follows the label until it is typed by hand. */
export function withSsoLabel(d: SsoDraft, label: string): Pick<SsoDraft, 'label' | 'providerId'> {
  const follows = !d.providerId || d.providerId === ssoProviderIdOf(d.label);
  return { label, providerId: follows ? ssoProviderIdOf(label) : d.providerId };
}

/** A draft the wizard sends: an empty one, added and left alone, is dropped. */
export function isSentSsoDraft(d: SsoDraft): boolean {
  return d.enabled || Boolean(d.label.trim()) || Boolean(d.clientId.trim());
}

/** What is wrong with the SSO providers the wizard would send, as a sentence, or null. */
export function ssoDraftsError(drafts: SsoDraft[]): string | null {
  const sent = drafts.filter(isSentSsoDraft);
  for (const p of sent) {
    if (p.enabled && !p.label.trim()) return 'Chaque fournisseur SSO doit avoir un libellé.';
    if (!p.providerId.trim()) return `Identifiant (slug) manquant pour "${p.label}".`;
    if (!ssoProviderIdSchema.safeParse(p.providerId.trim()).success)
      return `Identifiant (slug) invalide pour "${p.label}" : ${ID_RULE}.`;
    if (!p.enabled) continue;
    if (!follows(httpUrlSchema, p.issuerUrl.trim()))
      return `URL d'émetteur invalide pour "${p.label}".`;
    if (!p.clientId.trim()) return `Client ID manquant pour "${p.label}".`;
    if (!p.clientSecret.trim()) return `Client secret manquant pour "${p.label}".`;
  }
  const ids = sent.map((p) => p.providerId.trim());
  if (new Set(ids).size !== ids.length) return SETUP_ERRORS.sso_provider_duplicate_id;
  return null;
}
