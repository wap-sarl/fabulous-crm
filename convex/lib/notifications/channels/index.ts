import type { FunctionReference } from 'convex/server';
import type { z } from 'zod';
import type { Id } from '../../../_generated/dataModel';
import type { QueryCtx } from '../../../_generated/server';
import type { NotificationNames } from '../../../_lib/validators/notifications';
import type { PluginKey } from '../../../_lib/validators/plugins';
import { loadAppConfig } from '../../config/load';
import { loadInstalledPlugins } from '../../plugins/installed';
import { discordChannel } from './discord';
import { emailChannel } from './email';
import type { ChannelMessage, SendResult } from './send';
import { slackChannel } from './slack';

// Every channel the core can deliver to: the settings page, the fan-out and the preference mutation all read this list.

export type { SendResult } from './send';

export interface NotificationChannel {
  key: string;
  label: string;
  /** What turning it on does, said to the person on their settings page. */
  description: string;
  /** The plugin the channel comes with: absent for the core's own. */
  plugin?: PluginKey;
  /** What the person gives so the channel reaches them; a channel that asks for nothing writes to the address of their account. */
  target?: {
    label: string;
    placeholder: string;
    schema: z.ZodType<string>;
    secret: boolean;
    /** The part of a target the person's page may show once it is kept: a host, never the value. */
    hint?: (target: string) => string;
  };
  /** Whether the deployment has what the channel needs to deliver. */
  isConfigured(ctx: Pick<QueryCtx, 'db'>): Promise<boolean>;
  /** One delivery: begins it, sends, records the result (lib/notifications/deliveries.ts). */
  deliver: FunctionReference<'action', 'internal', { deliveryId: Id<'notificationDeliveries'> }>;
  /** For a channel that is one HTTP call: the call itself, which `deliverMessage` and « tester le canal » both make. */
  send?: (to: string, message: ChannelMessage) => Promise<SendResult>;
}

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [
  emailChannel,
  slackChannel,
  discordChannel,
];

export const channelOf = (key: string): NotificationChannel | undefined =>
  NOTIFICATION_CHANNELS.find((channel) => channel.key === key);

/** The channels that can deliver now: their plugin installed, their configuration complete. A toggle that is shown is a toggle that can deliver. */
export async function availableChannels(ctx: Pick<QueryCtx, 'db'>): Promise<NotificationChannel[]> {
  const installed = await loadInstalledPlugins(ctx);
  const available: NotificationChannel[] = [];
  for (const channel of NOTIFICATION_CHANNELS) {
    if (channel.plugin && !installed.includes(channel.plugin)) continue;
    if (await channel.isConfigured(ctx)) available.push(channel);
  }
  return available;
}

/** A plugin's channel while its plugin is installed and it can deliver: the one its settings page sets and tests. */
export async function pluginChannel(
  ctx: Pick<QueryCtx, 'db'>,
  key: string,
): Promise<NotificationChannel | undefined> {
  const channel = (await availableChannels(ctx)).find((entry) => entry.key === key);
  return channel?.plugin ? channel : undefined;
}

/** What a channel's messages may say: the administrator's choice for a plugin's channel, `full` until they make one; the core's own channels have no switch. */
export async function channelNames(
  ctx: Pick<QueryCtx, 'db'>,
  channel: NotificationChannel,
): Promise<NotificationNames> {
  if (!channel.plugin) return 'full';
  return (await loadAppConfig(ctx))?.notificationChannels?.[channel.key]?.names ?? 'full';
}
