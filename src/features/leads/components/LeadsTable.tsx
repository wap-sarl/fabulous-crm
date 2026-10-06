import { useMemo } from 'react';
import type { Id } from '@crm/lib/backend';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  Checkbox,
  Skeleton,
} from '@crm/design-system';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { LeadSortField, SortDirection } from '../hooks/useLeadFilters';
import type { LeadRow } from '../types';
import type { PropertyDefinitionRow } from '../../properties/types';
import { LeadTableRow } from './LeadTableRow';

interface LeadsTableProps {
  leads: LeadRow[];
  /** Show placeholder rows instead of the empty state while the first page loads. */
  isLoading?: boolean;
  /** Active custom property definitions; those with showInTable get a column. */
  definitions: PropertyDefinitionRow[];
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
  const visibleCols = useMemo(() => definitions.filter((d) => d.showInTable), [definitions]);
  const colCount = 9 + visibleCols.length;

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
            <TableHead>
              <SortHeader
                label="Score"
                field="leadScore"
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
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
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
            leads.map((lead) => (
              <LeadTableRow
                key={lead._id}
                lead={lead}
                selected={selectedIds.has(lead._id)}
                visibleCols={visibleCols}
                employeeName={employeeName}
                lifecycleLabel={lifecycleLabel}
                onToggleSelect={onToggleSelect}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpen={onOpen}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
