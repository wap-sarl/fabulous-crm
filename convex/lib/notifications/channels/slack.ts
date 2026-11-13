import { internal } from '../../../_generated/api';
import { slackWebhookSchema } from '../../../_lib/validators/notifications';
import type { NotificationChannel } from './index';
import { type ChannelMessage, type SendResult, waitAskedBy } from './send';

const SLACK_TIMEOUT_MS = 10_000;

/** A text as Slack's mrkdwn shows it literally: its three control characters escaped. */
const mrkdwn = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The message as Slack shows it: the title in bold, the body when there is one, a link that opens the record. */
export function slackMessage(message: ChannelMessage): { text: string } {
  const lines = [`*${mrkdwn(message.title)}*`];
  if (message.body) lines.push(mrkdwn(message.body));
  lines.push(`<${message.url}|Ouvrir dans le CRM>`);
  return { text: lines.join('\n') };
}

/** Slack's answers that will not change for this webhook: forbidden, gone, its channel archived. A 400 is not one of them: it may be our message, and a refusal turns the person's channel off. */
const REFUSALS = new Set([403, 404, 410]);

/** What a person may be shown of their webhook: the host and the workspace it writes to (`T…`, an identifier, not a secret); never the token that ends it. */
const slackHint = (url: string) => {
  const { host, pathname } = new URL(url);
  return `${host} · ${pathname.split('/')[2]}`;
};

/** One POST to the person's incoming webhook; an answer Slack will not change (webhook revoked, channel archived) is a refusal, the rest may pass later. Nothing of the URL is logged, nor of an error that may quote it. */
async function sendToSlack(to: string, message: ChannelMessage): Promise<SendResult> {
  const webhook = slackWebhookSchema.safeParse(to);
  if (!webhook.success) return 'refused';
  try {
    const response = await fetch(webhook.data, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slackMessage(message)),
      // A webhook answers itself: a redirect would carry the message to another host.
      redirect: 'error',
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
    if (response.ok) return 'sent';
    // Rate-limited: Slack says when to come back, and the delivery waits that long rather than burning an attempt.
    if (response.status === 429) return await waitAskedBy(response);
    return REFUSALS.has(response.status) ? 'refused' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The Slack plugin's channel: the notification as a message, to the incoming webhook the person pasted. */
export const slackChannel: NotificationChannel = {
  key: 'slack',
  label: 'Slack',
  description:
    'Chaque notification vous est aussi envoyée dans Slack, par votre webhook entrant, sauf si vous l’avez déjà lue dans le CRM.',
  plugin: 'slack',
  target: {
    label: 'URL de votre webhook entrant',
    placeholder: 'https://hooks.slack.com/services/…',
    schema: slackWebhookSchema,
    secret: true,
    hint: slackHint,
  },
  // A webhook per person: the deployment itself has nothing to set.
  isConfigured: async () => true,
  deliver: internal.features.notifications.actions.deliverMessage,
  send: sendToSlack,
};
