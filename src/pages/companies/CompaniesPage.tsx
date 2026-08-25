import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@crm/design-system';
import { Building2, ChevronRight, Plus, Search } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { countryName } from '../../lib/countries';
import { CompanyFormDialog } from '../../features/companies/components/CompanyFormDialog';

const PAGE_SIZE = 30;
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

export function CompaniesPage() {
  usePageTitle('Entreprises');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => {
    const id = setTimeout(() => {
      if (searchInput === search) return;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput) next.set('q', searchInput);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(id);
  }, [searchInput, search, setSearchParams]);

  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.companies.queries.listCompaniesPaginated,
    { search: search || undefined },
    { initialNumItems: PAGE_SIZE },
  );
  const counts = useAuthQuery(api.features.companies.queries.countCompanies, {});
  const isLoading = status === 'LoadingFirstPage';

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Entreprises"
        subtitle={counts ? `${counts.total} entreprise(s)` : undefined}
        actions={
          <Button onClick={() => setFormOpen(true)} data-testid="new-company">
            <Plus className="h-4 w-4" />
            Nouvelle entreprise
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
          <Input
            type="search"
            placeholder="Rechercher (nom, domaine, SIRET…)"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
            data-testid="companies-search"
          />
        </div>

        <div className="rounded-xl border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Nom</TableHead>
                <TableHead>Domaine</TableHead>
                <TableHead>Pays</TableHead>
                <TableHead>Contacts</TableHead>
                <TableHead>Créée le</TableHead>
                <TableHead className="w-10" aria-label="Ouvrir" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                SKELETON_ROWS.map((row) => (
                  <TableRow key={row} className="hover:bg-transparent">
                    <TableCell colSpan={6} className="py-3">
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-faint">
                    Aucune entreprise.
                  </TableCell>
                </TableRow>
              ) : (
                results.map((company) => (
                  <TableRow
                    key={company._id}
                    data-testid="company-row"
                    className="cursor-pointer"
                    onClick={() => navigate(`/companies/${company._id}`)}
                  >
                    <TableCell>
                      <span className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#EFEBFE] text-[#6A4BF0]">
                          <Building2 className="size-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {company.name}
                          </span>
                          <span className="block truncate text-[12.5px] text-faint">
                            {company.registrationNumber ?? company.sector ?? '—'}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-[13px] text-soft">{company.domain ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-soft">
                      {countryName(company.country)}
                    </TableCell>
                    <TableCell className="font-mono text-[12.5px] text-soft">
                      {company.contactCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-[12.5px] text-soft">
                      {dateFormat.format(company._creationTime)}
                    </TableCell>
                    <TableCell>
                      <ChevronRight className="h-4 w-4 text-[#C8CCD4]" aria-hidden />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {status === 'CanLoadMore' && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={() => loadMore(PAGE_SIZE)}>
              Charger plus
            </Button>
          </div>
        )}
      </div>

      <CompanyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={(id) => navigate(`/companies/${id}`)}
      />
    </div>
  );
}
