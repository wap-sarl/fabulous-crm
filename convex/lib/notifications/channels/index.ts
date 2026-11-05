import type { FunctionReference } from 'convex/server';
import type { z } from 'zod';
import type { Id } from '../../../_generated/dataModel';
import type { QueryCtx } from '../../../_generated/server';
import type { PluginKey } from '../../../_lib/validators/plugins';
import { loadInstalledPlugins } from '../../plugins/installed';
import { emailChannel } from './email';

// Every channel the core can deliver to: the settings page, the fan-out and the preference mutation all read this list.

export interface NotificationChannel {
  key: string;
  label: string;
  /** What turning it on does, said to the person on their settings page. */
  description: string;
  /** The plugin the channel comes with: absent for the core's own. */
  plugin?: PluginKey;
  /** What the person gives so the channel reaches them; a channel that asks for nothing writes to the address of their account. */
  target?: { label: string; placeholder: string; schema: z.ZodType<string>; secret: boolean };
  /** Whether the deployment has what the channel needs to deliver. */
  isConfigured(ctx: Pick<QueryCtx, 'db'>): Promise<boolean>;
  /** One delivery: begins it, sends, records the result (lib/notifications/deliveries.ts). */
  deliver: FunctionReference<'action', 'internal', { deliveryId: Id<'notificationDeliveries'> }>;
}

export const NOTIFICATION_CHANNELS: NotificationChannel[] = [emailChannel];

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
