import { internal } from '../../../_generated/api';
import { loadAppConfig } from '../../config/load';
import { emailPresence } from '../../email/provider';
import type { NotificationChannel } from './index';

/** The core's own external channel: the notification as a system e-mail, to the address of the person's account. */
export const emailChannel: NotificationChannel = {
  key: 'email',
  label: 'E-mail',
  description:
    'Chaque notification vous est aussi envoyée à l’adresse de votre compte, sauf si vous l’avez déjà lue dans le CRM.',
  isConfigured: async (ctx) => emailPresence(await loadAppConfig(ctx)).emailConfigured,
  deliver: internal.features.notifications.actions.deliverEmail,
};
