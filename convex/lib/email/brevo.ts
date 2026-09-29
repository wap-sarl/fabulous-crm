const BRAND_COLORS = {
  primary: '#2dd4bf',
  secondary: '#003C55',
  brandGreen: '#0EC17C',
};

/** The sender set per deployment (EMAIL_SENDER_NAME, EMAIL_SENDER_EMAIL); the email domain must be a verified Brevo sender. */
const SENDER = {
  name: process.env.EMAIL_SENDER_NAME || 'CRM',
  email: process.env.EMAIL_SENDER_EMAIL || 'noreply@example.com',
};

/** Escape a value for safe interpolation into HTML text/attribute context. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Values are HTML-escaped so a recipient's name can never inject markup; the substitution is done here rather than left to Brevo on raw HTML. */
export function renderPlaceholders(
  text: string,
  params: Record<string, string>,
  escapeValues = true,
): string {
  return text.replace(/\{\{\s*params\.([\w]+)\s*\}\}/g, (match, key: string) => {
    if (!(key in params)) return match;
    const value = params[key];
    return escapeValues ? escapeHtml(value) : value;
  });
}

/** Only a fragment is wrapped: a complete document, as an imported template, is returned verbatim so its own layout survives; Outlook hardening is not done. */
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

/** The messageId Brevo returns is what correlates the delivery events with the send. */
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
    sender?: { name: string; email: string };
  },
): Promise<{ ok: boolean; status: number; error?: string; messageId?: string }> {
  const body: Record<string, unknown> = {
    sender: sender ?? SENDER,
    to,
    subject,
    htmlContent,
  };

  if (attachment) {
    body.attachment = [attachment];
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

/** Brevo substitutes the `{{ params.x }}` placeholders of the template for each recipient. */
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
  },
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
