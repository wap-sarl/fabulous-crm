import { Link } from 'react-router-dom';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, type NotificationNames } from '@crm/lib/backend';
import { Button, Card, Skeleton, SwitchRow, toast } from '@crm/design-system';
import { useChannelTest } from '../lib/useChannelTest';

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
  const { test, testing } = useChannelTest(channel, settings?.label ?? '');

  if (!settings) return <Skeleton className="h-40 w-full" />;
  const { label } = settings;
  const setNames = (names: NotificationNames) =>
    void update({ channel, names }).catch(() => toast.error('Le réglage n’a pas été enregistré.'));
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
          , où chaque personne peut aussi tester la sienne.
          {!settings.targetSet && ' Vous n’en avez pas encore donné.'}
        </p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={test}
          disabled={testing || !settings.targetSet}
        >
          Tester le canal
        </Button>
      </Card>
    </div>
  );
}
