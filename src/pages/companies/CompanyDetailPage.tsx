import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { formatAddressOneLine, registrationSchemeFor, vatSchemeFor } from '@crm/lib/backend';
import {
  Button,
  Card,
  InitialsAvatar,
  KeyValueList,
  KeyValueRow,
  PageHeader,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { Building2, ChevronRight, Milestone, Pencil, Trash2, Users } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { countryName } from '../../lib/countries';
import { LEAD_STATUS_LABEL, LEAD_STATUS_TONE } from '../../lib/constants';
import { CompanyFormDialog } from '../../features/companies/components/CompanyFormDialog';
import {
  companyErrorMessage,
  useCompanyActions,
} from '../../features/companies/hooks/useCompanyActions';
import { useLifecycleConfig } from '../../features/leads/hooks/useLifecycleConfig';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const CONTACTS_PAGE = 25;

const ACTION_LABEL: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
};

function formatAddress(address: Parameters<typeof formatAddressOneLine>[0]): string {
  return formatAddressOneLine(address, countryName);
}

export function CompanyDetailPage() {
  usePageTitle('Entreprise');
  const navigate = useNavigate();
  const { companyId } = useParams<{ companyId: string }>();
  const id = companyId as Id<'companies'>;
  const company = useAuthQuery(
    api.features.companies.queries.getCompany,
    companyId ? { companyId: id } : 'skip',
  );
  const activity = useAuthQuery(
    api.features.companies.queries.listCompanyActivity,
    companyId ? { companyId: id } : 'skip',
  );
  const contacts = useAuthPaginatedQuery(
    api.features.crm.queries.listLeadsPaginated,
    companyId ? { companyIds: [id], sortField: 'recent', sortDirection: 'desc' } : 'skip',
    { initialNumItems: CONTACTS_PAGE },
  );
  const lifecycle = useLifecycleConfig();
  const { deleteCompany } = useCompanyActions();
  const [editOpen, setEditOpen] = useState(false);

  if (company === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }
  if (company === null) {
    return <p className="p-7 text-faint">Entreprise introuvable.</p>;
  }

  const scheme = registrationSchemeFor(company.country);
  const vatScheme = vatSchemeFor(company.country);

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Supprimer l’entreprise ${company.name} ? Ses ${company.contactCount} contact(s) sont conservés et détachés.`,
      )
    ) {
      return;
    }
    try {
      await deleteCompany({ companyId: company._id });
      toast.success('Entreprise supprimée.');
      navigate('/companies');
    } catch (e) {
      toast.error(companyErrorMessage(e, 'Échec de la suppression.'));
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        onBack={() => navigate('/companies')}
        leading={
          <span className="flex size-[46px] items-center justify-center rounded-xl bg-[#EFEBFE] text-[#6A4BF0]">
            <Building2 className="size-5" />
          </span>
        }
        title={company.name}
        titleExtra={
          company.lifecycleStage ? (
            <StatusBadge tone="violet" withDot={false}>
              <Milestone className="size-3" aria-hidden />
              {lifecycle.labelOf(company.lifecycleStage)}
            </StatusBadge>
          ) : undefined
        }
        subtitle={[company.domain, countryName(company.country)].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              Modifier
            </Button>
            <Button variant="ghost" onClick={handleDelete} aria-label="Supprimer l’entreprise">
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        }
      />

      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-5 px-5 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h2 className="mb-2 text-[15px] font-bold text-ink">Détails</h2>
            <KeyValueList>
              <KeyValueRow label="Pays">{countryName(company.country)}</KeyValueRow>
              <KeyValueRow label={scheme.label} mono>
                {company.registrationNumber ?? '—'}
              </KeyValueRow>
              <KeyValueRow label={vatScheme.label} mono>
                {company.vatNumber ?? '—'}
              </KeyValueRow>
              <KeyValueRow label="Domaine" mono>
                {company.domain ?? '—'}
              </KeyValueRow>
              <KeyValueRow label="Site web">
                {company.website ? (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {company.website}
                  </a>
                ) : (
                  '—'
                )}
              </KeyValueRow>
              <KeyValueRow label="Secteur">{company.sector ?? '—'}</KeyValueRow>
              <KeyValueRow label="Effectif" mono>
                {company.headcount !== undefined ? String(company.headcount) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Adresse">
                {company.address ? formatAddress(company.address) : '—'}
              </KeyValueRow>
              <KeyValueRow label="Créée le" mono>
                {dateFormat.format(company._creationTime)}
              </KeyValueRow>
            </KeyValueList>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-ink">
                Contacts <span className="font-normal text-faint">({company.contactCount})</span>
              </h2>
              <Link
                to={`/leads?company=${company._id}`}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Voir dans les leads
              </Link>
            </div>
            {contacts.status === 'LoadingFirstPage' ? (
              <Spinner size="sm" />
            ) : contacts.results.length === 0 ? (
              <p className="text-sm text-faint">
                Aucun contact. Les leads dont l’e-mail porte le domaine
                {company.domain ? ` ${company.domain}` : ' de l’entreprise'} y sont rattachés
                automatiquement.
              </p>
            ) : (
              <ul className="flex flex-col" data-testid="company-contacts">
                {contacts.results.map((lead) => {
                  const fullName = `${lead.firstName} ${lead.lastName}`;
                  return (
                    <li key={lead._id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/leads/${lead._id}`)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[#F7F8FA]"
                      >
                        <InitialsAvatar name={fullName} size={32} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-ink">
                            {fullName}
                          </span>
                          <span className="block truncate text-xs text-faint">
                            {lead.email ?? lead.phone ?? '—'}
                          </span>
                        </span>
                        <StatusBadge tone={LEAD_STATUS_TONE[lead.status]}>
                          {LEAD_STATUS_LABEL[lead.status]}
                        </StatusBadge>
                        <ChevronRight className="size-4 shrink-0 text-[#C8CCD4]" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {contacts.status === 'CanLoadMore' && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => contacts.loadMore(CONTACTS_PAGE)}
              >
                Charger plus
              </Button>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-ink">
              <Users className="size-4 text-faint" aria-hidden />
              Activité
            </h2>
            {activity === undefined ? (
              <Spinner size="sm" />
            ) : activity.length === 0 ? (
              <p className="text-sm text-faint">Aucune activité.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {activity.map((entry) => (
                  <li key={entry._id} className="flex flex-col gap-0.5 py-2 text-sm">
                    <span className="font-medium text-ink">
                      {ACTION_LABEL[entry.action] ?? entry.action}
                      {entry.metadata &&
                      typeof entry.metadata === 'object' &&
                      'source' in entry.metadata &&
                      entry.metadata.source === 'email_domain'
                        ? ' automatique (domaine e-mail)'
                        : ''}
                    </span>
                    <span className="text-xs text-faint">
                      {dateTimeFormat.format(entry.timestamp)} · {entry.userName ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <CompanyFormDialog open={editOpen} onOpenChange={setEditOpen} company={company} />
    </div>
  );
}
