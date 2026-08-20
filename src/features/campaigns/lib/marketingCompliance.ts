/**
 * Default opt-out text appended to marketing campaign bodies (RGPD / LCEN).
 *
 * Marketing SMS and emails must carry an unsubscribe path. We pre-fill it into the
 * editable body (visible and editable by the author) rather than force-injecting it
 * at send time. The link target is the existing `{{ params.consentUrl }}` placeholder,
 * substituted per recipient in `renderPlaceholders` (convex/lib/emailUtils.ts) to the
 * lead's public consent page (`/consent/:token`).
 *
 * All reconcilers are idempotent: they add the block when the campaign is marketing
 * and it is absent, and strip it when the campaign is transactional. Calling them
 * repeatedly (e.g. on every channel/type toggle) never duplicates or clobbers edits.
 */
import type { MessageType } from '@crm/lib/backend';

/** The consent-link placeholder, used both as the link target and the presence sentinel. */
const CONSENT_TOKEN = '{{ params.consentUrl }}';

/** Whitespace-tolerant match for the placeholder, mirroring `renderPlaceholders`. */
const CONSENT_RE = /\{\{\s*params\.consentUrl\s*\}\}/;

/** The opt-out line appended to a marketing SMS body. */
export const SMS_STOP_LINE = `STOP : ${CONSENT_TOKEN}`;

/**
 * The unsubscribe block appended to a marketing email body. Kept markup-minimal: an
 * `<hr>` for separation plus a plain paragraph — inline `style` attributes do not
 * survive TipTap's StarterKit serialization, so we don't rely on them.
 */
export const EMAIL_UNSUB_FOOTER_HTML =
  `<hr><p>Vous recevez cet e-mail car vous avez consenti à recevoir nos communications. ` +
  `Pour vous désinscrire, <a href="${CONSENT_TOKEN}">cliquez ici</a>.</p>`;

/**
 * Reconcile the SMS opt-out line with the message type.
 * Marketing → ensure the `STOP : <link>` line is present (appended once).
 * Transactional → remove any line carrying the consent placeholder.
 */
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

/**
 * Reconcile the email unsubscribe block with the message type.
 * Marketing → ensure the block is present (appended once).
 * Transactional → remove the block: the `<p>…{{ params.consentUrl }}…</p>` paragraph
 * plus an `<hr>` immediately preceding it, if any.
 */
export function withEmailCompliance(html: string, type: MessageType): string {
  if (type === 'marketing') {
    if (CONSENT_RE.test(html)) return html;
    return `${html}${EMAIL_UNSUB_FOOTER_HTML}`;
  }

  return html
    .replace(
      /(?:<hr\s*\/?>)?\s*<p>(?:(?!<\/p>)[\s\S])*?\{\{\s*params\.consentUrl\s*\}\}(?:(?!<\/p>)[\s\S])*?<\/p>/g,
      ''
    )
    .replace(/\s+$/, '');
}
