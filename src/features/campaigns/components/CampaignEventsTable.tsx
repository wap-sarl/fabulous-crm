import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthPaginatedQuery } from '@crm/widgets';
import {
  Button,
  Spinner,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@crm/design-system';
import { EVENT_TYPE_LABEL, EVENT_TYPE_TONE } from '../../../lib/constants';

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const PAGE_SIZE = 30;

/**
 * Cursor-paginated log of a campaign's delivery/engagement events
 * (campaignEvents), newest first. Rows open the recipient's preview sheet,
 * same as the recipients table.
 */
export function CampaignEventsTable({
  campaignId,
  recipientBySendId,
  onSelectSend,
}: {
  campaignId: Id<'campaigns'>;
  /** Send id → display name/contact, derived from the already-loaded sends. */
  recipientBySendId: Map<Id<'campaignSends'>, { name: string; contact: string }>;
  onSelectSend: (sendId: Id<'campaignSends'>) => void;
}) {
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.crm.queries.listCampaignEvents,
    { campaignId },
    { initialNumItems: PAGE_SIZE },
  );

  return (
    <div className="rounded-xl border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Date</TableHead>
            <TableHead>Destinataire</TableHead>
            <TableHead>Événement</TableHead>
            <TableHead className="pr-4">Détail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {status === 'LoadingFirstPage' ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="py-8 text-center">
                <Spinner />
              </TableCell>
            </TableRow>
          ) : results.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={4} className="py-8 text-center text-[13px] text-faint">
                Aucun événement pour le moment.
              </TableCell>
            </TableRow>
          ) : (
            results.map((event) => {
              const recipient = recipientBySendId.get(event.sendId);
              return (
                <TableRow
                  key={event._id}
                  className="cursor-pointer"
                  onClick={() => onSelectSend(event.sendId)}
                >
                  <TableCell className="whitespace-nowrap pl-4 font-mono text-[12.5px] text-soft">
                    {dateTimeFormat.format(event.eventAt)}
                  </TableCell>
                  <TableCell className="text-[13px] font-medium text-ink">
                    {recipient?.name || recipient?.contact || '—'}
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
            })
          )}
        </TableBody>
      </Table>
      {status === 'CanLoadMore' && (
        <div className="flex justify-center border-t py-2">
          <Button variant="ghost" onClick={() => loadMore(PAGE_SIZE)}>
            Charger plus
          </Button>
        </div>
      )}
    </div>
  );
}
