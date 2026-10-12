import type { Doc } from '@crm/lib/backend';
import { isSubscribed } from '@crm/lib/backend';
import { CONSENT_SOURCE_LABEL } from '../../../lib/constants';
import { dateFormat } from '@crm/lib/format';
import { useSubscriptionTypes } from '../hooks/useSubscriptionTypes';

/** Where the contact stands on each active type: nothing without the channel's consent, else their own choice dated and sourced, else what the basis says. */
export function LeadSubscriptions({
  lead,
}: {
  lead: Pick<Doc<'leads'>, 'marketingConsent' | 'subscriptions'>;
}) {
  const types = useSubscriptionTypes().filter((t) => t.active);
  if (types.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
      {types.map((type) => {
        const on = isSubscribed(lead, type);
        const own = lead.subscriptions?.find((s) => s.typeId === type._id);
        return (
          <li key={type._id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <span
                className={`size-2 rounded-full ${on ? 'bg-success' : 'bg-muted-foreground/40'}`}
                aria-hidden="true"
              />
              <span className={on ? 'text-ink' : 'text-soft'}>{type.name}</span>
            </span>
            <span className="text-xs text-faint">
              {!lead.marketingConsent.includes(type.channel)
                ? 'Canal refusé'
                : own
                  ? `${own.status === 'in' ? 'Inscrit' : 'Désinscrit'} le ${dateFormat.format(own.at)} · ${CONSENT_SOURCE_LABEL[own.source]}`
                  : on
                    ? 'Intérêt légitime'
                    : 'Non inscrit'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
