import { memo } from 'react';
import type { Id } from '@crm/lib/backend';
import { TableRow, TableCell, StatusBadge, InitialsAvatar, Checkbox, cn } from '@crm/design-system';
import { ChevronRight, Pencil, Trash2, Flag } from 'lucide-react';
import { dateFormat } from '@crm/lib/format';
import { CONSENT_CHANNEL_LABEL } from '../../../lib/constants';
import { formatPropertyValue } from '../../properties/lib/customProperties';
import type { PropertyDefinitionRow } from '../../properties/types';
import type { LeadRow } from '../types';
import { LeadScoreBadge } from './LeadScoreBadge';

/** Short chip labels for the consent channels (full labels are too long for a cell). */
const CONSENT_CHIP_LABEL: Record<string, string> = {
  email: 'E-mail',
  sms: 'SMS',
  telephone_canvassing: 'Tél.',
  postal: 'Courrier',
};

interface LeadTableRowProps {
  lead: LeadRow;
  selected: boolean;
  visibleCols: PropertyDefinitionRow[];
  employeeName: Map<string, string>;
  lifecycleLabel: (key: string | undefined) => string;
  onToggleSelect: (id: Id<'leads'>) => void;
  onEdit: (lead: LeadRow) => void;
  onDelete: (lead: LeadRow) => void;
  onOpen: (lead: LeadRow) => void;
}

/** Memoised: a tick, a dialog or a count that moves re-renders the rows it concerns, not the table; its props must keep their identity between renders. */
export const LeadTableRow = memo(function LeadTableRow({
  lead,
  selected,
  visibleCols,
  employeeName,
  lifecycleLabel,
  onToggleSelect,
  onEdit,
  onDelete,
  onOpen,
}: LeadTableRowProps) {
  const fullName = `${lead.firstName} ${lead.lastName}`;
  return (
    <TableRow data-testid="lead-row" className="cursor-pointer" onClick={() => onOpen(lead)}>
      <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(lead._id)}
          aria-label={`Sélectionner ${fullName}`}
        />
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-3">
          <span className="relative shrink-0">
            <InitialsAvatar name={fullName} size={36} />
            {lead.isRedFlagged && (
              <Flag
                className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-destructive text-destructive"
                aria-label="Signalé"
              />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">
              {lead.lastName} {lead.firstName}
            </span>
            <span className="block truncate text-[12.5px] text-faint">{lead.email ?? '—'}</span>
          </span>
        </span>
      </TableCell>
      <TableCell className="max-w-[180px] truncate text-[13px] text-soft">
        {lead.companyName ?? '—'}
      </TableCell>
      <TableCell>
        <StatusBadge tone="violet">{lifecycleLabel(lead.lifecycleStage)}</StatusBadge>
      </TableCell>
      <TableCell>
        <LeadScoreBadge score={lead.leadScore} />
      </TableCell>
      <TableCell className="text-[13px] text-soft">
        {lead.ownerIds.map((id) => employeeName.get(id) ?? '—').join(', ') || '—'}
      </TableCell>
      <TableCell>
        {lead.marketingConsent.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {lead.marketingConsent.map((c) => (
              <span
                key={c}
                title={CONSENT_CHANNEL_LABEL[c]}
                className="rounded-md bg-muted px-2 py-0.5 text-[11.5px] font-medium text-soft"
              >
                {CONSENT_CHIP_LABEL[c] ?? c}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-xs text-placeholder">Aucun</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap font-mono text-[12.5px] text-soft">
        {dateFormat.format(lead._creationTime)}
      </TableCell>
      {visibleCols.map((def) => (
        <TableCell key={def._id} className="whitespace-nowrap text-[13px] text-soft">
          {formatPropertyValue(def, lead.customProperties?.[def._id])}
        </TableCell>
      ))}
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={() => onEdit(lead)}
            aria-label="Modifier"
            className={cn(
              'flex size-[30px] cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-secondary hover:text-body',
            )}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(lead)}
            aria-label="Supprimer"
            className="flex size-[30px] cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-destructive-soft hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <ChevronRight className="ml-1 h-4 w-4 text-ghost" aria-hidden />
        </div>
      </TableCell>
    </TableRow>
  );
});
