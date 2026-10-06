import { memo } from 'react';
import type { FunctionReturnType } from 'convex/server';
import type { api, Id } from '@crm/lib/backend';
import { StatusBadge, TableCell, TableRow } from '@crm/design-system';
import { dateTimeFormat } from '@crm/lib/format';
import { sameRow } from '@crm/lib/sameRow';
import { EVENT_TYPE_LABEL, EVENT_TYPE_TONE } from '../../../lib/constants';

type EventRow = FunctionReturnType<
  typeof api.features.campaigns.queries.listCampaignEvents
>['page'][number];

interface CampaignEventRowProps {
  event: EventRow;
  onSelectSend: (sendId: Id<'campaignSends'>) => void;
}

/** One line of the event log. Memoised on what the event says: while a campaign is being sent every provider event updates the list, and only the new line is rendered. */
export const CampaignEventRow = memo(
  function CampaignEventRow({ event, onSelectSend }: CampaignEventRowProps) {
    const { recipient } = event;
    return (
      <TableRow className="cursor-pointer" onClick={() => onSelectSend(event.sendId)}>
        <TableCell className="whitespace-nowrap pl-4 font-mono text-[12.5px] text-soft">
          {dateTimeFormat.format(event.eventAt)}
        </TableCell>
        <TableCell className="text-[13px] font-medium text-ink">
          {recipient.name || recipient.contact || '—'}
        </TableCell>
        <TableCell>
          <StatusBadge tone={EVENT_TYPE_TONE[event.type]}>
            {EVENT_TYPE_LABEL[event.type]}
          </StatusBadge>
        </TableCell>
        <TableCell className="max-w-[280px] truncate pr-4 text-xs text-faint">
          {event.linkLabel ?? event.url ?? event.reason ?? ''}
        </TableCell>
      </TableRow>
    );
  },
  (before, after) =>
    before.onSelectSend === after.onSelectSend && sameRow(before.event, after.event),
);
