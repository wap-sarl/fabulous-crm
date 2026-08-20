import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { CampaignStatus } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Button,
  Input,
  PageHeader,
  Progress,
  SegmentedControl,
  Spinner,
  StatusBadge,
} from '@crm/design-system';
import { Calendar, Plus, Search, Users } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { CampaignChannelBadge } from '../../features/campaigns/components/CampaignChannelBadge';
import { CAMPAIGN_STATUSES, CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUS_TONE } from '../../lib/constants';

const numberFormat = new Intl.NumberFormat('fr-FR');

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ms));
}

export function CampaignsPage() {
  usePageTitle('Campagnes');
  const navigate = useNavigate();
  const campaigns = useAuthQuery(api.features.crm.queries.listCampaigns, {});

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CampaignStatus>('all');

  const filtered = useMemo(() => {
    if (!campaigns) return [];
    const q = search.trim().toLowerCase();
    return campaigns.filter(
      (c) =>
        (statusFilter === 'all' || c.status === statusFilter) &&
        (q === '' || c.name.toLowerCase().includes(q))
    );
  }, [campaigns, search, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<'all' | CampaignStatus, number>> = { all: campaigns?.length ?? 0 };
    for (const c of campaigns ?? []) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
    }
    return counts;
  }, [campaigns]);

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        title="Campagnes"
        subtitle={campaigns ? `${campaigns.length} campagne(s)` : 'Chargement…'}
        actions={
          <Button onClick={() => navigate('/campaigns/new')} data-testid="new-campaign">
            <Plus className="h-4 w-4" />
            Nouvelle campagne
          </Button>
        }
      />

      <div className="flex flex-col gap-4 px-5 pb-6 sm:px-7">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-placeholder" />
            <Input
              type="search"
              placeholder="Rechercher une campagne"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 pl-9"
            />
          </div>
          <SegmentedControl
            aria-label="Filtrer par statut"
            items={[
              { value: 'all', label: 'Toutes', count: statusCounts.all },
              ...CAMPAIGN_STATUSES.map((s) => ({
                value: s.value as string,
                label: s.label,
                count: statusCounts[s.value] ?? 0,
              })),
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as 'all' | CampaignStatus)}
          />
        </div>

        {campaigns === undefined ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border bg-card py-14 text-center text-faint shadow-card">
            Aucune campagne.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(336px,1fr))] gap-4">
            {filtered.map((c) => {
              const progress = c.totalCount > 0 ? (c.sentCount / c.totalCount) * 100 : 0;
              return (
                <button
                  key={c._id}
                  type="button"
                  data-testid="campaign-row"
                  onClick={() => navigate(`/campaigns/${c._id}`)}
                  className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-card transition-all hover:border-[#DADDE4] hover:shadow-card-hover"
                >
                  <div className="flex items-center justify-between gap-2">
                    <CampaignChannelBadge channel={c.channel} />
                    <StatusBadge tone={CAMPAIGN_STATUS_TONE[c.status]}>
                      {CAMPAIGN_STATUS_LABEL[c.status]}
                    </StatusBadge>
                  </div>

                  <div className="truncate text-base font-bold text-ink">{c.name}</div>

                  <div className="flex items-center gap-4 text-[12.5px] text-faint">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5" />
                      {numberFormat.format(c.totalCount)} destinataire(s)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="size-3.5" />
                      {formatDate(c._creationTime)}
                    </span>
                  </div>

                  <div className="h-px bg-[#F1F2F5]" />

                  <div className="flex items-end justify-between gap-3">
                    <div className="flex gap-5">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                          Envoyés
                        </div>
                        <div className="font-mono text-[15px] font-bold text-ink">
                          {numberFormat.format(c.sentCount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                          Échecs
                        </div>
                        <div className="font-mono text-[15px] font-bold text-ink">
                          {numberFormat.format(c.failedCount)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">
                          Progression
                        </div>
                        <div className="font-mono text-[15px] font-bold text-ink">
                          {progress.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                    <Progress value={progress} className="mb-1 w-24" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
