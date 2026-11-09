import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api, NOTIFICATION_TARGET_SCHEMAS, type NotificationGroup } from '@crm/lib/backend';
import { Card, SecretField, Skeleton, SwitchRow, toast } from '@crm/design-system';
import { errorLabel } from '@crm/lib/errors';
import { groupPresentationOf } from '../lib/presentation';

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
              {preferences.channels.map(({ key, label, description, enabled, target }) => (
                <div key={key}>
                  <SwitchRow
                    label={label}
                    description={description}
                    checked={enabled}
                    // A channel that asks for a target waits for it.
                    disabled={target !== undefined && !target.set}
                    onCheckedChange={(on) => save({ channels: { [key]: { enabled: on } } })}
                  />
                  {target && (
                    <SecretField
                      className="pb-3"
                      label={target.label}
                      placeholder={target.placeholder}
                      set={target.set}
                      hint={target.hint}
                      validate={targetProblem(key)}
                      // A first target turns the channel on; a replaced one leaves it as it was.
                      onSave={(value) =>
                        send({
                          channels: {
                            [key]: { enabled: target.set ? enabled : true, target: value },
                          },
                        })
                      }
                      onRemove={() =>
                        send({ channels: { [key]: { enabled: false, target: null } } })
                      }
                    />
                  )}
                </div>
              ))}
            </Card>
          )}
        </div>
      </section>
    </div>
  );
}
