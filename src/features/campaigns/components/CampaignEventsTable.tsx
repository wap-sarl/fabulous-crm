import { memo } from 'react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthPaginatedQuery } from '@crm/widgets';
import {
  Button,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@crm/design-system';
import { CampaignEventRow } from './CampaignEventRow';

const PAGE_SIZE = 30;

/** The log of a campaign's delivery and engagement events, newest first, each with who it reached; a row opens the recipient's preview, as in the recipients table. Memoised: the counters that move and the preview that opens leave its rows alone. */
export const CampaignEventsTable = memo(function CampaignEventsTable({
  campaignId,
  onSelectSend,
}: {
  campaignId: Id<'campaigns'>;
  onSelectSend: (sendId: Id<'campaignSends'>) => void;
}) {
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.campaigns.queries.listCampaignEvents,
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
            results.map((event) => (
              <CampaignEventRow key={event._id} event={event} onSelectSend={onSelectSend} />
            ))
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
});
