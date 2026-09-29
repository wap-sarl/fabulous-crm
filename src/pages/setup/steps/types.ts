import type { Id } from '@crm/lib/backend';
import { ssoProviderIdSchema } from '@crm/lib/backend';

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
      return `Identifiant (slug) invalide pour "${p.label}" : lettres minuscules et chiffres, séparés par des tirets.`;
    if (!p.enabled) continue;
    if (!/^https?:\/\//.test(p.issuerUrl.trim()))
      return `URL d'émetteur invalide pour "${p.label}".`;
    if (!p.clientId.trim()) return `Client ID manquant pour "${p.label}".`;
    if (!p.clientSecret.trim()) return `Client secret manquant pour "${p.label}".`;
  }
  const ids = sent.map((p) => p.providerId.trim());
  if (new Set(ids).size !== ids.length)
    return 'Les identifiants (slug) des fournisseurs SSO doivent être uniques.';
  return null;
}
