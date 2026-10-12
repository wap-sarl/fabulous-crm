import {
  HelperText,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@crm/design-system';
import type { CampaignChannel, Id } from '@crm/lib/backend';
import { useMatchingLeadCount } from '../../leads/hooks/useMatchingLeadCount';
import { useSubscriptionTypes } from '../hooks/useSubscriptionTypes';

const NONE = '__none__';

/** The subscription a marketing campaign writes under: the active types of its channel, or none for the channel's consent alone. */
export function SubscriptionTypePicker({
  channel,
  value,
  onChange,
}: {
  channel: CampaignChannel;
  value: Id<'subscriptionTypes'> | null;
  onChange: (next: Id<'subscriptionTypes'> | null) => void;
}) {
  const types = useSubscriptionTypes().filter((t) => t.active && t.channel === channel);
  // How many are in on the type at all, whatever the rest of the filter: after the upgrade, a topic nobody chose yet reaches nobody.
  const subscribed = useMatchingLeadCount(
    value
      ? {
          advancedFilter: {
            combinator: 'and',
            groups: [
              {
                combinator: 'and',
                rules: [
                  {
                    field: { kind: 'standard', field: 'subscribedTo' },
                    operator: 'contains',
                    value: [value],
                  },
                ],
              },
            ],
          },
        }
      : 'skip',
  );
  return (
    <div className="space-y-1.5 sm:max-w-sm">
      <Label>Abonnement visé</Label>
      <Select
        value={value ?? NONE}
        onValueChange={(v) => onChange(v === NONE ? null : (v as Id<'subscriptionTypes'>))}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Aucun : le consentement au canal suffit</SelectItem>
          {types.map((t) => (
            <SelectItem key={t._id} value={t._id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <HelperText>
        {value && subscribed
          ? `${subscribed.total} contact(s) inscrit(s) à cet abonnement. `
          : value
            ? 'Comptage des inscrits… '
            : ''}
        Seuls les contacts inscrits à cet abonnement reçoivent la campagne, quel que soit le filtre
        ; le lien de désinscription mène au centre de préférences.
      </HelperText>
    </div>
  );
}
