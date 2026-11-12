import { internal } from '../../../_generated/api';
import { discordWebhookSchema } from '../../../_lib/validators/notifications';
import type { ChannelMessage, NotificationChannel, SendResult } from './index';

const DISCORD_TIMEOUT_MS = 10_000;
/** Discord refuses a longer `content` with a 400, which would be retried for nothing. */
const DISCORD_CONTENT_MAX = 2000;

/** A text as Discord shows it literally: its formatting characters escaped, and what would open a mention, a channel or an emoji. */
const literal = (text: string) =>
  text.replace(/[\\*_~`|<[\]]/g, '\\$&').replace(/^([>#-])/gm, '\\$1');

/** The text within `max` UTF-16 units, as Discord counts them, cut at a code point so no emoji is left in halves, with an ellipsis. */
const clip = (text: string, max: number) => {
  if (text.length <= max) return text;
  let kept = '';
  for (const point of text) {
    if (kept.length + point.length > max - 1) break;
    kept += point;
  }
  return `${kept}…`;
};

/** The message as Discord shows it: the title in bold, the body when there is one, a link that opens the record without a preview card; no mention pings anyone, whatever a name contains. The link is kept whole, the title then the body give way to the limit. */
export function discordMessage(message: ChannelMessage): {
  content: string;
  allowed_mentions: { parse: [] };
} {
  const link = `[Ouvrir dans le CRM](<${message.url}>)`;
  const title = `**${clip(literal(message.title), DISCORD_CONTENT_MAX - link.length - 5)}**`;
  const room = DISCORD_CONTENT_MAX - title.length - link.length - 2;
  const body = message.body && room > 0 ? clip(literal(message.body), room) : '';
  return {
    content: [title, body, link].filter(Boolean).join('\n'),
    allowed_mentions: { parse: [] },
  };
}

/** Discord's answers that will not change for this webhook: a wrong token, forbidden, the webhook deleted. A 400 is not one of them: it may be our message, and a refusal turns the person's channel off. */
const REFUSALS = new Set([401, 403, 404]);

/** What a person may be shown of their webhook: the host and the webhook's id (an identifier, not a secret); never the token that ends it. */
const discordHint = (url: string) => {
  const { host, pathname } = new URL(url);
  return `${host} · ${pathname.split('/')[3]}`;
};

/** One POST to the person's channel webhook; an answer Discord will not change (webhook deleted, token wrong) is a refusal, the rest may pass later. Nothing of the URL is logged, nor of an error that may quote it. */
async function sendToDiscord(to: string, message: ChannelMessage): Promise<SendResult> {
  const webhook = discordWebhookSchema.safeParse(to);
  if (!webhook.success) return 'refused';
  try {
    const response = await fetch(webhook.data, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(discordMessage(message)),
      // A webhook answers itself: a redirect would carry the message to another host.
      redirect: 'error',
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
    if (response.ok) return 'sent';
    return REFUSALS.has(response.status) ? 'refused' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The Discord plugin's channel: the notification as a message, to the channel webhook the person pasted. */
export const discordChannel: NotificationChannel = {
  key: 'discord',
  label: 'Discord',
  description:
    'Chaque notification vous est aussi envoyée dans Discord, par le webhook de votre salon, sauf si vous l’avez déjà lue dans le CRM.',
  plugin: 'discord',
  target: {
    label: 'URL du webhook de votre salon',
    placeholder: 'https://discord.com/api/webhooks/…',
    schema: discordWebhookSchema,
    secret: true,
    hint: discordHint,
  },
  // A webhook per person: the deployment itself has nothing to set.
  isConfigured: async () => true,
  deliver: internal.features.notifications.actions.deliverMessage,
  send: sendToDiscord,
};
