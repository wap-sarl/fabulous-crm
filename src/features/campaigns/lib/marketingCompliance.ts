/** RGPD / LCEN: a marketing message must carry an unsubscribe path, pre-filled in the editable body rather than injected at send time; the reconcilers are idempotent. Every SMS carries it whatever its type: Brevo files a SMS holding its STOP code as marketing, and a consent link would cost half of a 160-character SMS that an alphanumeric sender cannot even receive replies to. */
import { SMS_STOP_LINE, SMS_STOP_RE, type MessageType } from '@crm/lib/backend';

/** The consent-link placeholder, used both as the link target and the presence sentinel. */
const CONSENT_TOKEN = '{{ params.consentUrl }}';

/** Whitespace-tolerant match for the placeholder, mirroring `renderPlaceholders`. */
const CONSENT_RE = /\{\{\s*params\.consentUrl\s*\}\}/;

/** The opt-out line appended to every SMS body, the server's own; a STOP reply comes back through the SMS webhook. */
export { SMS_STOP_LINE };

/** Minimal markup on purpose: inline `style` attributes do not survive the serialization of TipTap's StarterKit. */
export const EMAIL_UNSUB_FOOTER_HTML =
  `<hr><p>Vous recevez cet e-mail car vous êtes inscrit à nos communications. ` +
  `Pour gérer vos préférences ou vous désinscrire, <a href="${CONSENT_TOKEN}">cliquez ici</a>.</p>`;

/** The STOP line once, wherever the author left it; the legacy « STOP : <consent link> » lines go, the code does their job. */
export function withSmsCompliance(body: string): string {
  const kept = body
    .split('\n')
    .filter((line) => !(CONSENT_RE.test(line) && /STOP/i.test(line)))
    .join('\n');
  if (SMS_STOP_RE.test(kept)) return kept;
  const trimmed = kept.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${SMS_STOP_LINE}` : SMS_STOP_LINE;
}

/** Marketing gets the block once; transactional loses the paragraph that carries the consent placeholder and the `<hr>` right before it. */
export function withEmailCompliance(html: string, type: MessageType): string {
  if (type === 'marketing') {
    if (CONSENT_RE.test(html)) return html;
    return `${html}${EMAIL_UNSUB_FOOTER_HTML}`;
  }

  return html
    .replace(
      /(?:<hr\s*\/?>)?\s*<p>(?:(?!<\/p>)[\s\S])*?\{\{\s*params\.consentUrl\s*\}\}(?:(?!<\/p>)[\s\S])*?<\/p>/g,
      '',
    )
    .replace(/\s+$/, '');
}
