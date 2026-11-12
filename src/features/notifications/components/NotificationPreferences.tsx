import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import type { FunctionReturnType } from 'convex/server';
import { api, NOTIFICATION_TARGET_SCHEMAS, type NotificationGroup } from '@crm/lib/backend';
import {
  Button,
  Card,
  HelperText,
  SecretField,
  Skeleton,
  SwitchRow,
  toast,
} from '@crm/design-system';
import { errorLabel } from '@crm/lib/errors';
import { dateFormat } from '@crm/lib/format';
import { groupPresentationOf } from '../lib/presentation';
import { useChannelTest } from '../lib/useChannelTest';

const PREFERENCE_ERRORS: Record<string, string> = {
  unknown_notification_kind: 'Ce type de notification n’existe plus. Rechargez la page.',
  channel_not_available: 'Ce canal n’est plus disponible sur ce CRM.',
  invalid_channel_target: 'La destination donnée pour ce canal n’est pas valide.',
};

/** What is wrong with a target typed for a channel, by the rule the mutation applies; null when it passes, or when the channel has no rule here. */
const targetProblem = (channel: string) => (value: string) => {
  const checked = NOTIFICATION_TARGET_SCHEMAS[channel]?.safeParse(value);
  return checked && !checked.success ? (checked.error.issues[0]?.message ?? null) : null;
};

const myPreferences = api.features.notifications.queries.getMyNotificationPreferences;
type Preferences = FunctionReturnType<typeof myPreferences>;
type Choice = { channels: Record<string, { enabled: boolean; target?: string | null }> };

/** One channel: its switch, and for a channel that asks for a target, the field that keeps it, a test of it, and a word when the service refused it. */
function ChannelRow({
  channel: { key, label, description, enabled, target },
  send,
}: {
  channel: Preferences['channels'][number];
  send: (choice: Choice) => Promise<unknown>;
}) {
  const { test, testing } = useChannelTest(key, label);
  const choose = (choice: Choice['channels'][string]) => send({ channels: { [key]: choice } });
  return (
    <div>
      <SwitchRow
        label={label}
        description={description}
        checked={enabled}
        // A channel that asks for a target waits for it.
        disabled={target !== undefined && !target.set}
        onCheckedChange={(on) => void choose({ enabled: on }).catch(() => {})}
      />
      {target?.refusedAt !== undefined && (
        <HelperText variant="error" className="pb-2">
          {label} a refusé votre destination le {dateFormat.format(target.refusedAt)} : le canal a
          été désactivé. Remplacez-la, ou réactivez le canal si le problème est réglé côté {label}.
        </HelperText>
      )}
      {target && (
        <SecretField
          className="pb-3"
          label={target.label}
          placeholder={target.placeholder}
          set={target.set}
          hint={target.hint}
          validate={targetProblem(key)}
          // A first target turns the channel on, as does one that replaces a refused one; any other replacement leaves it as it was.
          onSave={(value) =>
            choose({
              enabled: target.set && target.refusedAt === undefined ? enabled : true,
              target: value,
            })
          }
          onRemove={() => choose({ enabled: false, target: null })}
          actions={
            <Button variant="ghost" size="sm" onClick={test} disabled={testing}>
              Tester
            </Button>
          }
        />
      )}
    </div>
  );
}

const SKELETON_ROWS = ['s1', 's2', 's3'];

/** A person's own settings: what they are told about, by group, then where; each switch saves itself. */
export function NotificationPreferences() {
  const preferences = useAuthQuery(myPreferences, {});
  // The switch moves at once; a refusal puts it back.
  const update = useAuthMutation(
    api.features.notifications.mutations.updateMyNotificationPreferences,
  ).withOptimisticUpdate((store, args) => {
    const shown = store.getQuery(myPreferences, {});
    if (!shown) return;
    store.setQuery(
      myPreferences,
      {},
      {
        kinds: shown.kinds.map((kind) => ({ ...kind, on: args.kinds?.[kind.key] ?? kind.on })),
        channels: shown.channels.map((channel) => ({
          ...channel,
          enabled: args.channels?.[channel.key]?.enabled ?? channel.enabled,
        })),
      },
    );
  });
  // Rejects after saying why: a field that waits for the answer stays open.
  const send = (choice: Parameters<typeof update>[0]) =>
    update(choice).catch((error) => {
      toast.error(errorLabel(error, PREFERENCE_ERRORS, 'Le réglage n’a pas été enregistré.'));
      throw error;
    });
  const save = (choice: Parameters<typeof update>[0]) => void send(choice).catch(() => {});

  if (!preferences) {
    return (
      <div className="space-y-3">
        {SKELETON_ROWS.map((key) => (
          <Skeleton key={key} className="h-24 w-full" />
        ))}
      </div>
    );
  }
  const groups = [...new Set(preferences.kinds.map((kind) => kind.group))] as NotificationGroup[];
  return (
    <div className="space-y-10">
      <section aria-labelledby="notification-kinds">
        <h2 id="notification-kinds" className="text-[15px] font-bold text-ink">
          Ce dont vous êtes informé·e
        </h2>
        <p className="text-sm text-soft">
          Un type désactivé n’arrive plus nulle part, ni dans le CRM ni sur vos canaux.
        </p>
        <div className="mt-4 space-y-4">
          {groups.map((group) => {
            const { icon: Icon, label } = groupPresentationOf(group);
            return (
              <Card key={group} className="px-4 py-1">
                <h3 className="flex items-center gap-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-faint">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </h3>
                <div className="divide-y divide-border">
                  {preferences.kinds
                    .filter((kind) => kind.group === group)
                    .map((kind) => (
                      <SwitchRow
                        key={kind.key}
                        label={kind.label}
                        checked={kind.on}
                        onCheckedChange={(on) => save({ kinds: { [kind.key]: on } })}
                      />
                    ))}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="notification-channels">
        <h2 id="notification-channels" className="text-[15px] font-bold text-ink">
          Où vous les recevez
        </h2>
        <p className="text-sm text-soft">
          La cloche du CRM est toujours active ; les canaux ci-dessous s’y ajoutent.
        </p>
        <div className="mt-4">
          {preferences.channels.length === 0 ? (
            <p className="text-sm text-soft">
              Aucun autre canal n’est disponible : l’envoi d’e-mails n’est pas configuré sur ce CRM.
            </p>
          ) : (
            <Card className="divide-y divide-border px-4 py-1">
              {preferences.channels.map((channel) => (
                <ChannelRow key={channel.key} channel={channel} send={send} />
              ))}
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
