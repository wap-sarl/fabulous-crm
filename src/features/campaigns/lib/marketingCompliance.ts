/** RGPD / LCEN: a marketing message must carry an unsubscribe path, pre-filled in the editable body rather than injected at send time; the reconcilers are idempotent. */
import type { MessageType } from '@crm/lib/backend';

/** The consent-link placeholder, used both as the link target and the presence sentinel. */
const CONSENT_TOKEN = '{{ params.consentUrl }}';

/** Whitespace-tolerant match for the placeholder, mirroring `renderPlaceholders`. */
const CONSENT_RE = /\{\{\s*params\.consentUrl\s*\}\}/;

/** The opt-out line appended to a marketing SMS body. */
export const SMS_STOP_LINE = `STOP : ${CONSENT_TOKEN}`;

/** Minimal markup on purpose: inline `style` attributes do not survive the serialization of TipTap's StarterKit. */
export const EMAIL_UNSUB_FOOTER_HTML =
  `<hr><p>Vous recevez cet e-mail car vous avez consenti à recevoir nos communications. ` +
  `Pour vous désinscrire, <a href="${CONSENT_TOKEN}">cliquez ici</a>.</p>`;

/** Marketing gets the STOP line once; transactional loses every line that carries the consent placeholder. */
export function withSmsCompliance(body: string, type: MessageType): string {
  if (type === 'marketing') {
    if (CONSENT_RE.test(body)) return body;
    const trimmed = body.replace(/\s+$/, '');
    return trimmed ? `${trimmed}\n\n${SMS_STOP_LINE}` : SMS_STOP_LINE;
  }

  return body
    .split('\n')
    .filter((line) => !CONSENT_RE.test(line))
    .join('\n')
    .replace(/\s+$/, '');
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
