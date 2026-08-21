import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import { Button, PageHeader, toast } from '@crm/design-system';
import { Plus, Upload, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useEmployees } from '../../lib/hooks/useEmployees';
import { useLeadFilters } from '../../features/leads/hooks/useLeadFilters';
import { useLeadsPaginated } from '../../features/leads/hooks/useLeadsPaginated';
import { useLeadActions } from '../../features/leads/hooks/useLeadActions';
import { useLeadPropertyDefinitions } from '../../features/leads/hooks/useLeadPropertyDefinitions';
import { LeadsToolbar } from '../../features/leads/components/LeadsToolbar';
import { AdvancedFilterBuilder } from '../../features/leads/components/AdvancedFilterBuilder';
import { LeadsTable } from '../../features/leads/components/LeadsTable';
import { LeadFormDialog } from '../../features/leads/components/LeadFormDialog';
import { CsvImportDialog } from '../../features/leads/components/CsvImportDialog';
import type { LeadRow } from '../../features/leads/types';

export function LeadsPage() {
  usePageTitle('Leads');
  const navigate = useNavigate();

  const { filters, setParam, setAdvancedFilter, toggleSort } = useLeadFilters();
  const { results, isLoading, hasMore, loadMore } = useLeadsPaginated(filters);
  const counts = useAuthQuery(api.features.crm.queries.countLeadsByStatus, {});
  const { employees } = useEmployees();
  const { deleteLead, deleteLeads } = useLeadActions();
  const propertyDefinitions = useLeadPropertyDefinitions();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<LeadRow | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);

  const employeeName = useMemo(
    () => new Map(employees.map((e) => [e._id, `${e.firstName} ${e.lastName}`])),
    [employees],
  );

  const leads = results ?? [];

  const toggleSelect = (id: Id<'leads'>) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => {
      const allSelected = leads.length > 0 && leads.every((l) => prev.has(l._id));
      if (allSelected) return new Set();
      return new Set(leads.map((l) => l._id));
    });

  const openCreate = () => {
    setEditingLead(undefined);
    setFormOpen(true);
  };

  const openEdit = (lead: LeadRow) => {
    setEditingLead(lead);
    setFormOpen(true);
  };

  const handleDelete = async (lead: LeadRow) => {
    if (!window.confirm(`Supprimer le lead ${lead.firstName} ${lead.lastName} ?`)) return;
    try {
      await deleteLead({ leadId: lead._id });
      toast.success('Lead supprimé.');
    } catch {
      toast.error('Échec de la suppression.');
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!window.confirm(`Supprimer les ${count} lead(s) sélectionné(s) ?`)) return;
    try {
      await deleteLeads({ leadIds: [...selectedIds] as Id<'leads'>[] });
      setSelectedIds(new Set());
      toast.success(`${count} lead(s) supprimé(s).`);
    } catch {
      toast.error('Échec de la suppression.');
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Leads"
        subtitle={
          selectedIds.size > 0
            ? `${selectedIds.size} sélectionné(s)`
            : counts
              ? `${leads.length} affiché(s) sur ${counts.total} lead(s)`
              : `${leads.length} lead(s) chargé(s)`
        }
        actions={
          <>
            {selectedIds.size > 0 && (
              <Button
                variant="fill"
                color="destructive"
                onClick={handleBulkDelete}
                data-testid="delete-selection"
              >
                <Trash2 className="h-4 w-4" />
                Supprimer ({selectedIds.size})
              </Button>
            )}
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" />
              Importer CSV
            </Button>
            <Button onClick={openCreate} data-testid="new-lead">
              <Plus className="h-4 w-4" />
              Nouveau lead
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <div className="flex flex-wrap items-start gap-3">
          <LeadsToolbar
            filters={filters}
            setParam={setParam}
            statusCounts={counts ? { all: counts.total, ...counts.byStatus } : undefined}
          />
          <AdvancedFilterBuilder
            filter={filters.advancedFilter}
            onChange={setAdvancedFilter}
            definitions={propertyDefinitions}
          />
        </div>

        <LeadsTable
          leads={leads}
          isLoading={isLoading}
          definitions={propertyDefinitions}
          employeeName={employeeName}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          sortField={filters.sortField}
          sortDirection={filters.sortDirection}
          onSort={toggleSort}
          onEdit={openEdit}
          onDelete={handleDelete}
          onOpen={(lead) => navigate(`/leads/${lead._id}`)}
        />

        {hasMore && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={loadMore}>
              Charger plus
            </Button>
          </div>
        )}
      </div>

      <LeadFormDialog open={formOpen} onOpenChange={setFormOpen} lead={editingLead} />
      <CsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
