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
import { CampaignSendRow } from './CampaignSendRow';

const PAGE_SIZE = 50;

/** The recipients of a campaign, one row per send, by pages; a row opens the recipient's preview, and a settled send can be sent again. Memoised: the counters that move and the preview that opens leave its rows alone, so its handlers must keep their identity. */
export const CampaignSendsTable = memo(function CampaignSendsTable({
  campaignId,
  isSms,
  canRetry,
  retrying,
  handleRetrySend,
  setSelectedSendId,
}: {
  campaignId: Id<'campaigns'>;
  isSms: boolean;
  canRetry: boolean;
  retrying: boolean;
  handleRetrySend: (sendId: Id<'campaignSends'>) => Promise<void>;
  setSelectedSendId: (sendId: Id<'campaignSends'>) => void;
}) {
  const {
    results: sends,
    status,
    loadMore,
  } = useAuthPaginatedQuery(
    api.features.campaigns.queries.listCampaignSends,
    { campaignId },
    { initialNumItems: PAGE_SIZE },
  );
  const columns = isSms ? 7 : 8;

  return (
    <div className="rounded-xl border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Destinataire</TableHead>
            <TableHead>{isSms ? 'Téléphone' : 'E-mail'}</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Envoyé le</TableHead>
            {!isSms && <TableHead>Ouvert</TableHead>}
            <TableHead>Cliqué</TableHead>
            <TableHead>Erreur</TableHead>
            <TableHead className="pr-4 text-right">Aperçu</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {status === 'LoadingFirstPage' ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns} className="py-8 text-center">
                <Spinner />
              </TableCell>
            </TableRow>
          ) : sends.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns} className="py-8 text-center text-[13px] text-faint">
                Aucun destinataire.
              </TableCell>
            </TableRow>
          ) : null}
          {sends.map((send) => (
            <CampaignSendRow
              key={send._id}
              send={send}
              isSms={isSms}
              canRetry={canRetry}
              retrying={retrying}
              handleRetrySend={handleRetrySend}
              setSelectedSendId={setSelectedSendId}
            />
          ))}
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
