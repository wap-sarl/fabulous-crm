import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Play, RotateCcw, Trash2, XCircle } from 'lucide-react';
import {
  Button,
  Card,
  ConfirmDialog,
  PageHeader,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { api, type Id } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { useConvex } from 'convex/react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { downloadText, errorRowsCsv } from '../../features/imports/lib/errorCsv';
import { describeImportError, describeJobError } from '../../features/imports/lib/errorLabels';
import { IMPORT_SPECS } from '../../features/imports/lib/registry';
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from './importStatus';
import { Stat } from '../../features/imports/components/Stat';
import { RowList } from '../../features/imports/components/RowList';
import { dateTimeFormat, numberFormat } from '@crm/lib/format';

/** « Import » of one file: the dry run's verdicts, the run and its report. */
export function ImportJobPage() {
  usePageTitle('Import');
  const navigate = useNavigate();
  const convex = useConvex();
  const { jobId } = useParams<{ jobId: Id<'importJobs'> }>();
  const job = useAuthQuery(api.features.imports.queries.getJob, jobId ? { jobId } : 'skip');
  const launchJob = useAuthMutation(api.features.imports.mutations.launchJob);
  const resumeJob = useAuthMutation(api.features.imports.mutations.resumeJob);
  const cancelJob = useAuthMutation(api.features.imports.mutations.cancelJob);
  const deleteJob = useAuthMutation(api.features.imports.mutations.deleteJob);
  const [policy, setPolicy] = useState<'update' | 'create'>('update');
  const [confirm, setConfirm] = useState<'cancel' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  if (!jobId) return null;
  if (job === undefined) {
    return (
      <div className="flex flex-col gap-3 px-5 py-6 sm:px-7">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const spec = IMPORT_SPECS[job.entity];
  const busyStatus =
    job.status === 'simulating' || job.status === 'running' || job.status === 'uploading';
  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(describeError(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const exportErrors = async () => {
    const { headers, rows, capped } = await convex.query(api.features.imports.queries.errorRows, {
      jobId,
    });
    downloadText(
      `erreurs-${job.fileName.replace(/\.[^.]+$/, '')}.csv`,
      errorRowsCsv(
        headers,
        rows.map((r) => ({ ...r, error: describeImportError(r.error) })),
      ),
    );
    if (capped) toast.info('Le fichier contient les premières lignes en erreur seulement.');
  };

  const counts = job.counts;
  const simulated = job.status === 'simulated';
  const finished = job.status === 'done';
  // The tiles count what the run did once it started, what the dry run would do before.
  const ran = finished || job.status === 'running' || job.interruptedFrom === 'running';

  return (
    <div className="flex flex-col">
      <PageHeader
        className="px-5 sm:px-7"
        onBack={() => navigate(`/import?entity=${job.entity}`)}
        title={job.fileName}
        titleExtra={
          <StatusBadge tone={JOB_STATUS_TONE[job.status]}>
            {JOB_STATUS_LABEL[job.status]}
          </StatusBadge>
        }
        subtitle={`${spec.label} · ${numberFormat.format(job.totalRows)} ligne(s) · ${dateTimeFormat.format(job._creationTime)}${
          job.listName ? ` · liste « ${job.listName} »` : ''
        }${job.mappingName ? ` · correspondance « ${job.mappingName} »` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {job.status === 'interrupted' && (
              <Button
                onClick={() => act(() => resumeJob({ jobId }), 'La reprise a échoué.')}
                loading={busy}
              >
                <RotateCcw className="h-4 w-4" />
                Reprendre
              </Button>
            )}
            {simulated && (
              <Button
                onClick={() =>
                  act(
                    () =>
                      launchJob({
                        jobId,
                        duplicatePolicy: counts.duplicates > 0 ? policy : undefined,
                      }),
                    'Le lancement a échoué.',
                  )
                }
                loading={busy}
                disabled={counts.created + counts.updated + counts.duplicates === 0}
                data-testid="launch-import"
              >
                <Play className="h-4 w-4" />
                Lancer l’import
              </Button>
            )}
            {(busyStatus || simulated || job.status === 'interrupted') && (
              <Button variant="outline" onClick={() => setConfirm('cancel')}>
                <XCircle className="h-4 w-4" />
                Annuler
              </Button>
            )}
            {(finished || job.status === 'cancelled') && (
              <Button variant="outline" onClick={() => setConfirm('delete')}>
                <Trash2 className="h-4 w-4" />
                Supprimer le rapport
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-col gap-3 px-5 pb-6 sm:px-7">
        {busyStatus && (
          <Card className="space-y-2 p-4">
            <Progress value={job.progress * 100} />
            <p className="text-sm text-soft">
              {job.status === 'simulating'
                ? 'Simulation en cours'
                : job.status === 'running'
                  ? 'Import en cours'
                  : 'Envoi des lignes'}{' '}
              · {numberFormat.format(Math.min(job.totalRows, job.nextBatch * job.batchSize))}/
              {numberFormat.format(job.totalRows)} ligne(s)
            </p>
          </Card>
        )}

        {job.status === 'interrupted' && (
          <Card className="border-red-200 bg-red-50 p-4 text-sm">
            <p className="font-medium text-ink">
              {job.interruptedFrom === 'running' ? 'Import interrompu' : 'Simulation interrompue'}{' '}
              au lot {job.nextBatch + 1}.
            </p>
            <p className="text-soft">
              {job.error ? describeJobError(job.error) : 'Une erreur est survenue.'} Les lots
              précédents sont enregistrés ; « Reprendre » repart de ce lot, sans rien écrire deux
              fois.
            </p>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label={ran ? 'Créés' : 'À créer'} value={counts.created} />
          <Stat label={ran ? 'Mis à jour' : 'À mettre à jour'} value={counts.updated} />
          {!ran && <Stat label="Doublons probables" value={counts.duplicates} tone="amber" />}
          <Stat label="En erreur" value={counts.errors} tone={counts.errors ? 'red' : undefined} />
        </div>

        {simulated && (
          <Card className="space-y-2 p-4 text-sm">
            <p className="font-medium text-ink">Rien n’a été écrit.</p>
            <p className="text-soft">
              La simulation applique les règles de l’import (un e-mail connu met à jour la fiche, un
              identifiant ou un nom connu met à jour l’entreprise…) sans rien enregistrer. Lancez
              l’import pour écrire ce qui est annoncé.
            </p>
            {counts.duplicates > 0 && (
              <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="font-medium text-ink">
                  {numberFormat.format(counts.duplicates)} ligne(s) ressemblent à des fiches
                  existantes sans partager leur e-mail.
                </p>
                <Select value={policy} onValueChange={(v) => setPolicy(v as 'update' | 'create')}>
                  <SelectTrigger className="h-9" data-testid="duplicate-policy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="update">Mettre à jour les fiches existantes</SelectItem>
                    <SelectItem value="create">Créer de nouvelles fiches malgré tout</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </Card>
        )}

        {finished && job.simulated && (
          <p className="text-xs text-faint">
            Simulation : {numberFormat.format(job.simulated.created)} à créer,{' '}
            {numberFormat.format(job.simulated.updated)} à mettre à jour,{' '}
            {numberFormat.format(job.simulated.duplicates)} doublon(s) probable(s),{' '}
            {numberFormat.format(job.simulated.errors)} en erreur.
            {job.finishedAt ? ` Terminé le ${dateTimeFormat.format(job.finishedAt)}.` : ''}
          </p>
        )}

        {simulated && counts.duplicates > 0 && (
          <RowList
            jobId={jobId}
            outcome="duplicate"
            headers={job.headers}
            title="Doublons probables"
          />
        )}
        {simulated && counts.updated > 0 && (
          <RowList jobId={jobId} outcome="update" headers={job.headers} title="Mises à jour" />
        )}
        {counts.errors > 0 && !busyStatus && (
          <RowList
            jobId={jobId}
            outcome="error"
            headers={job.headers}
            title="Lignes en erreur"
            action={
              <Button variant="outline" size="sm" onClick={() => void exportErrors()}>
                <Download className="h-4 w-4" />
                Exporter les lignes en erreur
              </Button>
            }
          />
        )}
        {finished && (
          <div>
            <Button variant="outline" onClick={() => navigate(spec.listPath)}>
              Voir les {spec.label.toLowerCase()}
            </Button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'delete' ? 'Supprimer ce rapport ?' : 'Annuler cet import ?'}
        description={
          confirm === 'delete'
            ? 'Le rapport et ses lignes en erreur sont supprimés. Ce qui a été importé reste.'
            : 'Ce qui a déjà été écrit reste ; les lignes restantes ne seront pas importées.'
        }
        confirmLabel={confirm === 'delete' ? 'Supprimer' : 'Annuler l’import'}
        destructive
        onConfirm={async () => {
          const which = confirm;
          setConfirm(null);
          if (which === 'delete') {
            await act(async () => {
              await deleteJob({ jobId });
              navigate(`/import?entity=${job.entity}`);
            }, 'La suppression a échoué.');
          } else if (which === 'cancel') {
            await act(() => cancelJob({ jobId }), 'L’annulation a échoué.');
          }
        }}
      />
    </div>
  );
}
