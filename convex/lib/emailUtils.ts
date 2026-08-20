/**
 * Shared email utilities for Brevo email sending.
 * Extracts brand constants, HTML layout, and API helper used across multiple action files.
 */

export const BRAND_COLORS = {
  primary: '#2dd4bf',
  secondary: '#003C55',
  brandGreen: '#0EC17C',
};

/**
 * Sender identity for every outgoing email. Configure per deployment with
 * `bunx convex env set EMAIL_SENDER_NAME …` / `EMAIL_SENDER_EMAIL …`;
 * the email domain must be a verified Brevo sender.
 */
export const SENDER = {
  name: process.env.EMAIL_SENDER_NAME || 'CRM',
  email: process.env.EMAIL_SENDER_EMAIL || 'noreply@example.com',
};

/**
 * Format a timestamp to French date/time string in Europe/Paris timezone.
 * Example: "15 mars 2026 à 14h00"
 */
export function formatDateTimeFrench(timestampMs: number): string {
  const date = new Date(timestampMs);
  const dayMonth = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(date);
  const hours = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
    hour12: false,
  }).format(date);
  // Intl gives "14:00", we want "14h00"
  return `${dayMonth} à ${hours.replace(':', 'h')}`;
}

/**
 * Format a timestamp to French date-only string in Europe/Paris timezone.
 * Example: "15 mars 2026"
 */
export function formatDateOnlyFrench(timestampMs: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(timestampMs));
}

/**
 * Format a timestamp to French time string in Europe/Paris timezone.
 * Example: "09h00"
 */
export function formatTimeFrenchFromMs(timestampMs: number): string {
  const time = new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
    hour12: false,
  }).format(new Date(timestampMs));
  return time.replace(':', 'h');
}

/** Escape a value for safe interpolation into HTML text/attribute context. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Substitute `{{ params.KEY }}` placeholders (whitespace-tolerant) with the
 * matching value from `params`. Unknown keys are left untouched. When `escape`
 * is true (HTML body/subject rendered into markup) values are HTML-escaped so a
 * recipient's name can never inject markup. Deterministic and unit-testable —
 * we substitute ourselves rather than relying on Brevo to interpolate raw HTML.
 */
export function renderPlaceholders(
  text: string,
  params: Record<string, string>,
  escape = true
): string {
  return text.replace(/\{\{\s*params\.([\w]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in params)) return match;
    const value = params[key];
    return escape ? escapeHtml(value) : value;
  });
}

/**
 * Wrap WYSIWYG-authored body HTML in a minimal, email-safe document shell:
 * doctype, charset, and a max-width centered container with base inline font
 * and color styles. Targets Gmail/Apple Mail correctness for v1; Outlook
 * table-hardening (e.g. via `juice`) is a deliberate later step.
 *
 * Idempotent: an imported campaign template is already a complete HTML document
 * (starts with a doctype or `<html>` tag) and is returned verbatim so its own
 * layout and styles survive — only WYSIWYG fragments (`<p>…`) get wrapped.
 */
export function wrapEmailHtml(bodyHtml: string): string {
  if (/<!doctype|<html[\s>]/i.test(bodyHtml)) return bodyHtml;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;">
<div style="max-width:600px;margin:0 auto;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:${BRAND_COLORS.secondary};background-color:#ffffff;">
${bodyHtml}
</div>
</body>
</html>`;
}

/**
 * Send an email via Brevo SMTP API, optionally with a file attachment.
 * Returns Brevo's messageId on success for delivery tracking.
 */
export async function sendBrevoEmail(
  apiKey: string,
  {
    to,
    subject,
    htmlContent,
    attachment,
    sender,
  }: {
    to: { email: string; name?: string }[];
    subject: string;
    htmlContent: string;
    attachment?: { name: string; content: string }; // content = base64
    /** Overrides the env-derived SENDER (e.g. from runtime appConfig). */
    sender?: { name: string; email: string };
  }
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  const body: Record<string, unknown> = {
    sender: sender ?? SENDER,
    to,
    subject,
    htmlContent,
  };

  if (attachment) {
    body['attachment'] = [attachment];
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    'api-key': apiKey,
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Brevo API error:', response.status, errorBody);
    return { ok: false, status: response.status, error: errorBody };
  }

  const data = (await response.json().catch(() => ({}))) as { messageId?: string };
  return { ok: true, status: response.status, messageId: data.messageId };
}

/**
 * Send an email via Brevo using a transactional template id with per-recipient
 * placeholder substitution ({{ params.x }} in the template). Used by CRM
 * campaigns. Returns Brevo's messageId on success for delivery tracking.
 */
export async function sendBrevoTemplateEmail(
  apiKey: string,
  {
    to,
    templateId,
    params,
  }: {
    to: { email: string; name?: string }[];
    templateId: number;
    params?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify({ sender: SENDER, to, templateId, params }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Brevo template API error:', response.status, errorBody);
    return { ok: false, status: response.status, error: errorBody };
  }

  const data = (await response.json().catch(() => ({}))) as { messageId?: string };
  return { ok: true, status: response.status, messageId: data.messageId };
}

