import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthAction, useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, type NotificationNames } from '@crm/lib/backend';
import { Button, Card, Skeleton, SwitchRow, toast } from '@crm/design-system';
import { errorLabel } from '@crm/lib/errors';

const TEST_ERRORS: Record<string, string> = {
  channel_not_available: 'Ce canal n’est plus disponible sur ce CRM.',
  no_channel_target: 'Renseignez d’abord votre destination dans Paramètres → Notifications.',
};

/** What an administrator sets once for a plugin's channel: whether its messages carry names, and a test message to their own target. */
export function ChannelPluginSettings({ channel }: { channel: string }) {
  const args = { channel };
  const settingsOf = api.features.notifications.queries.getNotificationChannelSettings;
  const settings = useAuthQuery(settingsOf, args);
  // The switch moves at once; a refusal puts it back.
  const update = useAuthMutation(
    api.features.notifications.mutations.updateNotificationChannelSettings,
  ).withOptimisticUpdate((store, { names }) => {
    const shown = store.getQuery(settingsOf, args);
    if (shown) store.setQuery(settingsOf, args, { ...shown, names });
  });
  const test = useAuthAction(api.features.notifications.actions.testNotificationChannel);
  const [testing, setTesting] = useState(false);

  if (!settings) return <Skeleton className="h-40 w-full" />;
  const { label } = settings;
  const setNames = (names: NotificationNames) =>
    void update({ channel, names }).catch(() => toast.error('Le réglage n’a pas été enregistré.'));
  const onTest = async () => {
    setTesting(true);
    try {
      const result = await test({ channel });
      if (result === 'sent') toast.success(`Message de test envoyé : regardez dans ${label}.`);
      else if (result === 'refused') {
        toast.error(`${label} a refusé le message : votre destination n’est plus valable.`);
      } else toast.error(`${label} n’a pas répondu. Réessayez dans un instant.`);
    } catch (error) {
      toast.error(errorLabel(error, TEST_ERRORS, 'Le test n’a pas pu être envoyé.'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="px-5 py-4">
        <h2 className="text-[15px] font-bold text-ink">Ce qui sort du CRM</h2>
        <p className="mt-1 text-sm text-soft">
          Un message porte le titre de la notification, son texte et un lien vers la fiche : le nom
          d’un lead, d’une transaction ou d’un collègue part donc vers {label}, chez les personnes
          qui ont activé ce canal.
        </p>
        <SwitchRow
          className="mt-2"
          label="Inclure les noms dans les messages"
          description="Désactivé, un message ne dit que le type de notification et donne le lien vers le CRM."
          checked={settings.names === 'full'}
          onCheckedChange={(full) => setNames(full ? 'full' : 'none')}
        />
      </Card>
      <Card className="px-5 py-4">
        <h2 className="text-[15px] font-bold text-ink">Tester le canal</h2>
        <p className="mt-1 text-sm text-soft">
          Envoie un message de test à votre propre destination, celle de{' '}
          <Link to="/settings/notifications" className="text-primary hover:underline">
            Paramètres → Notifications
          </Link>
          .{!settings.targetSet && ' Vous n’en avez pas encore donné.'}
        </p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={onTest}
          disabled={testing || !settings.targetSet}
        >
          Tester le canal
        </Button>
      </Card>
    </div>
  );
}
