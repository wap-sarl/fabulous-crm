import type { Id } from '@crm/lib/backend';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  StatusBadge,
  InitialsAvatar,
  Checkbox,
  Skeleton,
  cn,
} from '@crm/design-system';
import { ChevronUp, ChevronDown, ChevronRight, Pencil, Trash2, Flag } from 'lucide-react';
import { CONSENT_CHANNEL_LABEL } from '../../../lib/constants';
import type { LeadSortField, SortDirection } from '../hooks/useLeadFilters';
import type { LeadRow, LeadPropertyDefinitionRow } from '../types';
import { formatPropertyValue } from '../lib/customProperties';

interface LeadsTableProps {
  leads: LeadRow[];
  /** Show placeholder rows instead of the empty state while the first page loads. */
  isLoading?: boolean;
  /** Active custom property definitions; those with showInTable get a column. */
  definitions: LeadPropertyDefinitionRow[];
  employeeName: Map<string, string>;
  /** Label of a lifecycle stage key (useLifecycleConfig().labelOf). */
  lifecycleLabel: (key: string | undefined) => string;
  selectedIds: Set<string>;
  onToggleSelect: (id: Id<'leads'>) => void;
  onToggleSelectAll: () => void;
  sortField: LeadSortField;
  sortDirection: SortDirection;
  onSort: (field: LeadSortField) => void;
  onEdit: (lead: LeadRow) => void;
  onDelete: (lead: LeadRow) => void;
  onOpen: (lead: LeadRow) => void;
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/** Short chip labels for the consent channels (full labels are too long for a cell). */
const CONSENT_CHIP_LABEL: Record<string, string> = {
  email: 'E-mail',
  sms: 'SMS',
  telephone_canvassing: 'Tél.',
  postal: 'Courrier',
};

function SortHeader({
  label,
  field,
  sortField,
  sortDirection,
  onSort,
}: {
  label: string;
  field: LeadSortField;
  sortField: LeadSortField;
  sortDirection: SortDirection;
  onSort: (field: LeadSortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="inline-flex cursor-pointer items-center gap-1 font-semibold uppercase hover:text-body"
    >
      {label}
      {active ? (
        sortDirection === 'asc' ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : null}
    </button>
  );
}

export function LeadsTable({
  leads,
  isLoading = false,
  definitions,
  employeeName,
  lifecycleLabel,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  sortField,
  sortDirection,
  onSort,
  onEdit,
  onDelete,
  onOpen,
}: LeadsTableProps) {
  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l._id));
  const visibleCols = definitions.filter((d) => d.showInTable);
  const colCount = 8 + visibleCols.length;

  return (
    <div className="rounded-xl border bg-card shadow-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pl-4">
              <Checkbox
                checked={allSelected}
                onCheckedChange={onToggleSelectAll}
                aria-label="Tout sélectionner"
              />
            </TableHead>
            <TableHead>
              <SortHeader
                label="Nom"
                field="lastName"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>Entreprise</TableHead>
            <TableHead>
              <SortHeader
                label="Statut"
                field="lifecycleStage"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            <TableHead>Assigné</TableHead>
            <TableHead>Consentements</TableHead>
            <TableHead>
              <SortHeader
                label="Créé le"
                field="recent"
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </TableHead>
            {visibleCols.map((def) => (
              <TableHead key={def._id} className="whitespace-nowrap font-semibold uppercase">
                {def.label}
              </TableHead>
            ))}
            <TableHead className="w-24 text-right" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`} className="hover:bg-transparent">
                <TableCell colSpan={colCount} className="py-3">
                  <Skeleton className="h-9 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : leads.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colCount} className="py-10 text-center text-faint">
                Aucun lead.
              </TableCell>
            </TableRow>
          ) : (
            leads.map((lead) => {
              const fullName = `${lead.firstName} ${lead.lastName}`;
              return (
                <TableRow
                  key={lead._id}
                  data-testid="lead-row"
                  className="cursor-pointer"
                  onClick={() => onOpen(lead)}
                >
                  <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(lead._id)}
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
                        <span className="block truncate text-[12.5px] text-faint">
                          {lead.email ?? '—'}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-[13px] text-soft">
                    {lead.companyName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone="violet">{lifecycleLabel(lead.lifecycleStage)}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-[13px] text-soft">
                    {lead.assignedTo ? (employeeName.get(lead.assignedTo) ?? '—') : '—'}
                  </TableCell>
                  <TableCell>
                    {lead.marketingConsent.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {lead.marketingConsent.map((c) => (
                          <span
                            key={c}
                            title={CONSENT_CHANNEL_LABEL[c]}
                            className="rounded-md bg-[#F2F3F5] px-2 py-0.5 text-[11.5px] font-medium text-soft"
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
                          'flex size-[30px] cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-[#EEF0F3] hover:text-body',
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
                      <ChevronRight className="ml-1 h-4 w-4 text-[#C8CCD4]" aria-hidden />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
