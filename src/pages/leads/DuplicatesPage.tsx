import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthPaginatedQuery, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { DuplicateLeadSummary, Id } from '@crm/lib/backend';
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { ArrowLeftRight, EyeOff, ScanSearch } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { MergeLeadsDialog } from '../../features/leads/components/MergeLeadsDialog';
import {
  duplicateErrorMessage,
  useDuplicateActions,
} from '../../features/leads/hooks/useDuplicateActions';
import { DUPLICATE_REASON_LABEL, DUPLICATE_REASON_TONE } from '../../features/leads/lib/duplicates';

const PAGE_SIZE = 20;
const SKELETON_ROWS = ['s1', 's2', 's3'];
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

function LeadSide({ lead }: { lead: DuplicateLeadSummary }) {
  return (
    <div className="min-w-0 flex-1">
      <Link
        to={`/leads/${lead._id}`}
        className="block truncate text-sm font-semibold text-ink hover:underline"
      >
        {lead.name}
      </Link>
      <p className="truncate text-xs text-soft">{lead.email ?? '—'}</p>
      <p className="truncate font-mono text-xs text-soft">{lead.phone ?? '—'}</p>
      <p className="truncate text-xs text-faint">
        {lead.city ? `${lead.city} · ` : ''}créé le {dateFormat.format(lead.createdAt)}
      </p>
    </div>
  );
}

/** « Doublons potentiels »: scan control, open pairs, compare & merge. */
export function DuplicatesPage() {
  usePageTitle('Doublons');
  const navigate = useNavigate();
  const scan = useAuthQuery(api.features.duplicates.queries.getLatestDuplicateScan, {});
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.duplicates.queries.listDuplicatePairs,
    { status: 'open' },
    { initialNumItems: PAGE_SIZE },
  );
  const { startDuplicateScan, ignoreDuplicatePair } = useDuplicateActions();
  const [starting, setStarting] = useState(false);
  const [comparing, setComparing] = useState<Id<'leadDuplicates'> | null>(null);
  const running = scan?.status === 'running';

  const launch = async () => {
    setStarting(true);
    try {
      await startDuplicateScan({});
      toast.success('Analyse lancée.');
    } catch (e) {
      toast.error(duplicateErrorMessage(e, 'Impossible de lancer l’analyse.'));
    } finally {
      setStarting(false);
    }
  };

  const ignore = async (pairId: Id<'leadDuplicates'>) => {
    try {
      await ignoreDuplicatePair({ pairId });
    } catch (e) {
      toast.error(duplicateErrorMessage(e, 'Échec.'));
    }
  };

  const subtitle = !scan
    ? 'Aucune analyse pour le moment.'
    : running
      ? `Analyse en cours… ${scan.scanned} lead(s) parcouru(s), ${scan.found} paire(s) trouvée(s)`
      : `Dernière analyse le ${dateTimeFormat.format(scan.finishedAt ?? scan.startedAt)}${
          scan.startedByName ? ` par ${scan.startedByName}` : ''
        } : ${scan.scanned} lead(s) parcouru(s), ${scan.found} nouvelle(s) paire(s)`;

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        onBack={() => navigate('/leads')}
        title="Doublons potentiels"
        subtitle={subtitle}
        actions={
          <Button onClick={launch} loading={starting} disabled={running} data-testid="start-scan">
            {running ? <Spinner size="sm" /> : <ScanSearch className="h-4 w-4" />}
            {running ? 'Analyse en cours' : 'Lancer une analyse'}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 px-5 pb-6 sm:px-7">
        <p className="text-xs text-faint">
          Deux fiches sont rapprochées quand elles partagent un e-mail ou un téléphone, un nom et un
          code postal, ou des noms très proches. Fusionnez-les en choisissant les valeurs à garder,
          ou ignorez la paire.
        </p>

        {status === 'LoadingFirstPage' ? (
          SKELETON_ROWS.map((row) => <Skeleton key={row} className="h-24 w-full" />)
        ) : results.length === 0 ? (
          <Card className="p-8 text-center text-sm text-faint">
            Aucun doublon potentiel.{!scan ? ' Lancez une analyse pour parcourir les leads.' : ''}
          </Card>
        ) : (
          results.map((pair) => (
            <Card key={pair._id} className="p-4" data-testid="duplicate-pair">
              <div className="flex flex-wrap items-start gap-4">
                <LeadSide lead={pair.leadA} />
                <ArrowLeftRight className="mt-2 size-4 shrink-0 text-[#C8CCD4]" aria-hidden />
                <LeadSide lead={pair.leadB} />
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
                  <div className="flex flex-wrap gap-1.5">
                    {pair.reasons.map((r) => (
                      <StatusBadge key={r} tone={DUPLICATE_REASON_TONE[r]} withDot={false}>
                        {DUPLICATE_REASON_LABEL[r]}
                      </StatusBadge>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => ignore(pair._id)}>
                      <EyeOff className="size-4" />
                      Ignorer
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setComparing(pair._id)}
                      data-testid="compare-pair"
                    >
                      Comparer et fusionner
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}

        {status === 'CanLoadMore' && (
          <div className="flex justify-center">
            <Button variant="ghost" onClick={() => loadMore(PAGE_SIZE)}>
              Charger plus
            </Button>
          </div>
        )}
      </div>

      <MergeLeadsDialog pairId={comparing} onClose={() => setComparing(null)} />
    </div>
  );
}
