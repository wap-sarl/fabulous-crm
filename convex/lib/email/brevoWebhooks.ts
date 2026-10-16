import type { resolveBrevo } from './provider';

type Brevo = Awaited<ReturnType<typeof resolveBrevo>>;

/** An account-level Brevo webhook on this deployment's route: a re-run updates ours (matched by endpoint) instead of stacking duplicates; with none, Brevo answers the error `document_not_found`, not an empty list. The secret goes in a header, never in the URL, where it would sit in proxy logs and in Brevo's webhook listing. */
export async function registerBrevoWebhook(
  brevo: Brevo,
  webhook: {
    path: string;
    channel?: 'sms';
    // Transactional by default; marketing for the SMS Brevo files as such once they carry its STOP code.
    type?: 'transactional' | 'marketing';
    description: string;
    events: string[];
  },
): Promise<{ action: string; id: number; url: string }> {
  const apiKey = brevo.apiKey;
  const secret = brevo.webhookSecret;
  const siteUrl = process.env.CONVEX_SITE_URL;
  for (const [name, value] of [
    ['BREVO_API_KEY', apiKey],
    ['BREVO_WEBHOOK_SECRET', secret],
    ['CONVEX_SITE_URL', siteUrl],
  ] as const) {
    if (!value) throw new Error(`Configuration manquante : ${name}`);
  }
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'api-key': apiKey!,
  };
  const endpoint = `${siteUrl}${webhook.path}`;
  const type = webhook.type ?? 'transactional';
  const body = JSON.stringify({
    type,
    ...(webhook.channel && { channel: webhook.channel }),
    description: webhook.description,
    url: endpoint,
    headers: [{ key: 'x-webhook-secret', value: secret }],
    events: webhook.events,
  });

  const listUrl = `https://api.brevo.com/v3/webhooks?type=${type}${webhook.channel ? `&channel=${webhook.channel}` : ''}`;
  const listResponse = await fetch(listUrl, { headers });
  const listBody = (await listResponse.json().catch(() => ({}))) as {
    webhooks?: { id: number; url: string }[];
    code?: string;
  };
  if (!listResponse.ok && listBody.code !== 'document_not_found') {
    throw new Error(`Brevo GET /webhooks a échoué : ${JSON.stringify(listBody)}`);
  }
  const existing = listBody.webhooks?.find((w) => w.url.startsWith(endpoint));

  const response = existing
    ? await fetch(`https://api.brevo.com/v3/webhooks/${existing.id}`, {
        method: 'PUT',
        headers,
        body,
      })
    : await fetch('https://api.brevo.com/v3/webhooks', { method: 'POST', headers, body });
  if (!response.ok) {
    throw new Error(
      `Brevo ${existing ? 'PUT' : 'POST'} /webhooks a échoué : ${await response.text()}`,
    );
  }

  const id = existing?.id ?? ((await response.json()) as { id: number }).id;
  return { action: existing ? 'updated' : 'created', id, url: endpoint };
}
