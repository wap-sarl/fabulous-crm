import type {
  CampaignEventType,
  CampaignSendStatus,
  CampaignStatus,
  DealStatus,
  LeadStatus,
  MarketingConsentChannel,
} from '@crm/lib/backend';
import { LEAD_STATUS_LABELS } from '@crm/lib/backend';
import type { StatusTone } from '@crm/design-system';

/** Lead pipeline statuses with French labels (shared with the backend) and badge tones. */
export const LEAD_STATUSES: {
  value: LeadStatus;
  label: string;
  tone: StatusTone;
}[] = [
  { value: 'nouveau', label: LEAD_STATUS_LABELS.nouveau, tone: 'blue' },
  { value: 'contacte', label: LEAD_STATUS_LABELS.contacte, tone: 'amber' },
  { value: 'interesse', label: LEAD_STATUS_LABELS.interesse, tone: 'violet' },
  { value: 'converti', label: LEAD_STATUS_LABELS.converti, tone: 'green' },
  { value: 'perdu', label: LEAD_STATUS_LABELS.perdu, tone: 'red' },
];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = LEAD_STATUS_LABELS;

export const LEAD_STATUS_TONE: Record<LeadStatus, StatusTone> = Object.fromEntries(
  LEAD_STATUSES.map((s) => [s.value, s.tone]),
) as Record<LeadStatus, StatusTone>;

/** Campaign statuses with French labels and badge tones. */
export const CAMPAIGN_STATUSES: {
  value: CampaignStatus;
  label: string;
  tone: StatusTone;
}[] = [
  { value: 'draft', label: 'Brouillon', tone: 'gray' },
  { value: 'preparing', label: 'Préparation', tone: 'amber' },
  { value: 'sending', label: 'En cours', tone: 'blue' },
  { value: 'sent', label: 'Envoyée', tone: 'green' },
  { value: 'failed', label: 'Échec', tone: 'red' },
];

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = Object.fromEntries(
  CAMPAIGN_STATUSES.map((s) => [s.value, s.label]),
) as Record<CampaignStatus, string>;

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, StatusTone> = Object.fromEntries(
  CAMPAIGN_STATUSES.map((s) => [s.value, s.tone]),
) as Record<CampaignStatus, StatusTone>;

/** Per-recipient campaign send statuses with French labels and badge tones. */
export const SEND_STATUSES: {
  value: CampaignSendStatus;
  label: string;
  tone: StatusTone;
}[] = [
  { value: 'pending', label: 'En attente', tone: 'amber' },
  { value: 'sent', label: 'Envoyé', tone: 'green' },
  { value: 'failed', label: 'Échec', tone: 'red' },
  { value: 'skipped_no_email', label: 'Ignoré — pas d’e-mail', tone: 'gray' },
  { value: 'skipped_no_phone', label: 'Ignoré — pas de téléphone', tone: 'gray' },
];

export const SEND_STATUS_LABEL: Record<CampaignSendStatus, string> = Object.fromEntries(
  SEND_STATUSES.map((s) => [s.value, s.label]),
) as Record<CampaignSendStatus, string>;

export const SEND_STATUS_TONE: Record<CampaignSendStatus, StatusTone> = Object.fromEntries(
  SEND_STATUSES.map((s) => [s.value, s.tone]),
) as Record<CampaignSendStatus, StatusTone>;

/**
 * Turn a raw provider send error into a readable French message for the campaign
 * UI. Brevo returns a JSON body like `{"code":"unauthorized","message":"Key not
 * found"}`; SMTP/other providers return plain strings. Known failures get a clear
 * message; anything else falls back to the provider's own `message`, then the raw
 * text — so the original string is never lost (surface it in a `title` tooltip).
 */
export function formatSendError(raw: string | undefined | null): string {
  if (!raw) return '';
  let code = '';
  let message = raw;
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; message?: unknown };
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.code === 'string') code = parsed.code.toLowerCase();
      if (typeof parsed.message === 'string') message = parsed.message;
    }
  } catch {
    // Not JSON (e.g. an SMTP error string) — keep the raw text.
  }
  const haystack = `${code} ${message}`.toLowerCase();

  if (code === 'unauthorized' || haystack.includes('key not found')) {
    return 'Clé API Brevo invalide ou révoquée — vérifiez Paramètres → E-mail.';
  }
  if (code === 'not_enough_credits' || haystack.includes('not enough credit')) {
    return 'Crédits Brevo insuffisants pour cet envoi.';
  }
  if (
    haystack.includes('sender') &&
    (haystack.includes('not valid') ||
      haystack.includes('not authorized') ||
      haystack.includes('unknown'))
  ) {
    return 'Expéditeur non validé par Brevo.';
  }
  if (
    haystack.includes('invalid') &&
    (haystack.includes('recipient') ||
      haystack.includes('phone') ||
      haystack.includes('number') ||
      haystack.includes('email'))
  ) {
    return 'Coordonnée du destinataire invalide.';
  }
  // Unknown provider error: prefer its own message over the raw JSON envelope.
  return message;
}

/** Campaign delivery/engagement event types with French labels and badge tones. */
export const EVENT_TYPES: {
  value: CampaignEventType;
  label: string;
  tone: StatusTone;
}[] = [
  { value: 'delivered', label: 'Délivré', tone: 'blue' },
  { value: 'opened', label: 'Ouvert', tone: 'violet' },
  { value: 'clicked', label: 'Cliqué', tone: 'green' },
  { value: 'link_click', label: 'Lien suivi cliqué', tone: 'green' },
  { value: 'hard_bounce', label: 'Rebond définitif', tone: 'red' },
  { value: 'soft_bounce', label: 'Rebond temporaire', tone: 'amber' },
  { value: 'spam', label: 'Plainte spam', tone: 'red' },
  { value: 'unsubscribed', label: 'Désinscrit', tone: 'red' },
  { value: 'blocked', label: 'Bloqué', tone: 'red' },
  { value: 'invalid', label: 'Adresse invalide', tone: 'red' },
  { value: 'error', label: 'Erreur', tone: 'red' },
  { value: 'sms_reply', label: 'Réponse SMS', tone: 'blue' },
];

export const EVENT_TYPE_LABEL: Record<CampaignEventType, string> = Object.fromEntries(
  EVENT_TYPES.map((e) => [e.value, e.label]),
) as Record<CampaignEventType, string>;

export const EVENT_TYPE_TONE: Record<CampaignEventType, StatusTone> = Object.fromEntries(
  EVENT_TYPES.map((e) => [e.value, e.tone]),
) as Record<CampaignEventType, StatusTone>;

/** Marketing consent channels with French labels. */
export const CONSENT_CHANNELS: { value: MarketingConsentChannel; label: string }[] = [
  { value: 'email', label: 'E-mail' },
  { value: 'sms', label: 'SMS' },
  { value: 'telephone_canvassing', label: 'Démarchage téléphonique' },
  { value: 'postal', label: 'Courrier postal' },
];

export const CONSENT_CHANNEL_LABEL: Record<MarketingConsentChannel, string> = Object.fromEntries(
  CONSENT_CHANNELS.map((c) => [c.value, c.label]),
) as Record<MarketingConsentChannel, string>;

export const DEAL_STATUSES: { value: DealStatus; label: string; tone: StatusTone }[] = [
  { value: 'open', label: 'En cours', tone: 'blue' },
  { value: 'won', label: 'Gagnée', tone: 'green' },
  { value: 'lost', label: 'Perdue', tone: 'red' },
];
export const DEAL_STATUS_LABEL: Record<DealStatus, string> = Object.fromEntries(
  DEAL_STATUSES.map((s) => [s.value, s.label]),
) as Record<DealStatus, string>;
export const DEAL_STATUS_TONE: Record<DealStatus, StatusTone> = Object.fromEntries(
  DEAL_STATUSES.map((s) => [s.value, s.tone]),
) as Record<DealStatus, StatusTone>;

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'MAD'] as const;

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number | undefined | null, currency: string): string {
  if (amount === undefined || amount === null) return '—';
  let format = moneyFormats.get(currency);
  if (!format) {
    try {
      format = new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      });
    } catch {
      format = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
    }
    moneyFormats.set(currency, format);
  }
  return format.format(amount);
}
