import type { Doc, Id } from '@crm/lib/backend';
import {
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@crm/design-system';
import { Eye, RotateCcw } from 'lucide-react';
import { SEND_STATUS_LABEL, SEND_STATUS_TONE, formatSendError } from '../../../lib/constants';
import { dateTimeFormat } from '@crm/lib/format';
import { sendLeadName } from '../lib/sends';

/** The recipients of a campaign, one row per send; a row opens the recipient's preview, and a settled send can be sent again. */
export function CampaignSendsTable({
  sends,
  isSms,
  canRetry,
  retrying,
  handleRetrySend,
  setSelectedSendId,
}: {
  sends: Doc<'campaignSends'>[];
  isSms: boolean;
  canRetry: boolean;
  retrying: boolean;
  handleRetrySend: (sendId: Id<'campaignSends'>) => Promise<void>;
  setSelectedSendId: (sendId: Id<'campaignSends'>) => void;
}) {
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
          {sends.map((s) => {
            const name = sendLeadName(s.params);
            return (
              <TableRow
                key={s._id}
                className="cursor-pointer"
                onClick={() => setSelectedSendId(s._id)}
              >
                <TableCell className="pl-4 text-[13px] font-medium text-ink">
                  {name || '—'}
                </TableCell>
                <TableCell className="text-[13px] text-body">
                  {(isSms ? s.phone : s.email) ?? '—'}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={SEND_STATUS_TONE[s.status]}>
                    {SEND_STATUS_LABEL[s.status]}
                  </StatusBadge>
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-[12.5px] text-soft">
                  {s.sentAt ? dateTimeFormat.format(s.sentAt) : '—'}
                </TableCell>
                {!isSms && (
                  <TableCell>
                    {s.openedAt ? (
                      <span title={dateTimeFormat.format(s.openedAt)}>
                        <StatusBadge tone="violet">Ouvert</StatusBadge>
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  {s.clickedAt ? (
                    <span title={dateTimeFormat.format(s.clickedAt)}>
                      <StatusBadge tone="green">Cliqué</StatusBadge>
                    </span>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-faint">
                  {s.error ? <span title={s.error}>{formatSendError(s.error)}</span> : ''}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    {s.status !== 'pending' && canRetry && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRetrySend(s._id);
                        }}
                        disabled={retrying}
                        title="Renvoyer l'envoi"
                        aria-label={`Renvoyer l'envoi à ${name || s.email || s.phone || 'ce destinataire'}`}
                        className="inline-flex cursor-pointer items-center justify-center text-soft transition-colors hover:text-primary disabled:cursor-default disabled:opacity-40"
                      >
                        <RotateCcw className="size-4" />
                      </button>
                    )}
                    <span className="inline-flex items-center justify-center text-soft transition-colors hover:text-primary">
                      <Eye className="size-4" />
                    </span>
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
