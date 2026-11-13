import { useState } from 'react';
import { useAuthAction } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { toast } from '@crm/design-system';
import { errorLabel } from '@crm/lib/errors';

const TEST_ERRORS: Record<string, string> = {
  channel_not_available: 'Ce canal n’est plus disponible sur ce CRM.',
  no_channel_target: 'Renseignez d’abord votre destination dans Paramètres → Notifications.',
  channel_target_unreadable:
    'Votre destination n’est plus lisible. Enregistrez-la de nouveau dans Paramètres → Notifications.',
};

/** « Tester le canal »: one message to the caller's own target on a channel, and a word on what the service made of it. */
export function useChannelTest(channel: string, label: string) {
  const send = useAuthAction(api.features.notifications.actions.testNotificationChannel);
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    try {
      const result = await send({ channel });
      if (result === 'sent') toast.success(`Message de test envoyé : regardez dans ${label}.`);
      else if (result === 'refused') {
        toast.error(`${label} a refusé le message : votre destination n’est plus valable.`);
      } else if (result === 'rate_limited') {
        toast.error(`${label} demande d’attendre : réessayez dans un instant.`);
      } else toast.error(`${label} n’a pas répondu. Réessayez dans un instant.`);
    } catch (error) {
      toast.error(errorLabel(error, TEST_ERRORS, 'Le test n’a pas pu être envoyé.'));
    } finally {
      setTesting(false);
    }
  };
  return { test, testing };
}
