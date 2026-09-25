import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { z } from 'zod';
import { api, RETENTION_BOUNDS, type RetentionKey } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import {
  Button,
  Card,
  HelperText,
  Input,
  Label,
  PageHeader,
  Spinner,
  toast,
} from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';

const FIELDS: { key: RetentionKey; label: string; hint: string }[] = [
  {
    key: 'softDeleteDays',
    label: 'Fiches supprimées (jours)',
    hint: 'Leads, entreprises, transactions et activités supprimés restent restaurables pendant cette durée, puis sont effacés avec tout ce qui s’y rattache.',
  },
  {
    key: 'eventDays',
    label: 'Événements (jours)',
    hint: 'Événements de campagne (ouvertures, clics, rebonds), journal des étapes de workflow, liens suivis des campagnes terminées et rapports d’import.',
  },
  {
    key: 'auditDays',
    label: 'Journal d’audit (jours)',
    hint: 'Historique des modifications ; la trace des purges elle-même suit cette durée.',
  },
];

const days = (key: RetentionKey) => {
  const { min, max } = RETENTION_BOUNDS[key];
  return z.coerce
    .number({ message: 'Indiquez un nombre de jours.' })
    .int('Indiquez un nombre entier de jours.')
    .min(min, `Entre ${min} et ${max} jours.`)
    .max(max, `Entre ${min} et ${max} jours.`);
};
const schema = z.object({
  softDeleteDays: days('softDeleteDays'),
  eventDays: days('eventDays'),
  auditDays: days('auditDays'),
});
type Form = Record<RetentionKey, string>;

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const fmt = new Intl.NumberFormat('fr-FR');

const COUNT_LABELS: Record<string, string> = {
  leads: 'leads',
  companies: 'entreprises',
  deals: 'transactions',
  activities: 'activités',
  related: 'lignes rattachées',
  attachments: 'fichiers',
  campaignEvents: 'événements de campagne',
  workflowRunSteps: 'étapes de workflow',
  campaignLinkTokens: 'liens suivis',
  invitations: 'invitations expirées',
  apiIdempotencyKeys: 'clés d’idempotence',
  importRows: 'lignes d’import en erreur',
  importJobs: 'rapports d’import',
  auditLogs: 'lignes d’audit',
};

function RetentionManager() {
  const config = useQuery(api.features.config.queries.getAdminConfig);
  const last = useQuery(api.features.retention.queries.lastPurge);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const [form, setForm] = useState<Form | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config && !form) {
      setForm({
        softDeleteDays: String(config.retention.softDeleteDays),
        eventDays: String(config.retention.eventDays),
        auditDays: String(config.retention.auditDays),
      });
    }
  }, [config, form]);

  if (!config || !form) return <Spinner size="sm" />;

  const parsed = schema.safeParse(form);
  const errors: Partial<Record<RetentionKey, string>> = {};
  if (submitted && !parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] as RetentionKey] ??= issue.message;
    }
  }

  const save = async () => {
    setSubmitted(true);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await updateConfig({
        retentionSoftDeleteDays: parsed.data.softDeleteDays,
        retentionEventDays: parsed.data.eventDays,
        retentionAuditDays: parsed.data.auditDays,
      });
      toast.success('Durées de conservation enregistrées.');
      setSubmitted(false);
    } catch {
      toast.error('L’enregistrement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const counts = (last?.report?.counts ?? {}) as Record<string, number>;
  const purged = Object.entries(counts).filter(([, n]) => n > 0);

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-6">
        {FIELDS.map(({ key, label, hint }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`retention-${key}`}>{label}</Label>
            <Input
              id={`retention-${key}`}
              type="number"
              min={RETENTION_BOUNDS[key].min}
              max={RETENTION_BOUNDS[key].max}
              value={form[key]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              aria-invalid={errors[key] !== undefined}
              className="w-40"
            />
            {errors[key] ? (
              <HelperText variant="error">{errors[key]}</HelperText>
            ) : (
              <HelperText>{hint}</HelperText>
            )}
          </div>
        ))}
        <p className="text-sm text-soft">
          La purge passe chaque nuit et efface ce qui dépasse ces durées, par lots. Les fichiers
          joints ont leur propre corbeille (page Fichiers).
        </p>
        <div className="flex justify-end">
          <Button onClick={save} loading={busy}>
            Enregistrer
          </Button>
        </div>
      </Card>
      <Card className="space-y-2 p-6">
        <h2 className="text-sm font-semibold text-ink">Dernière purge</h2>
        {last === undefined ? (
          <Spinner size="sm" />
        ) : last === null ? (
          <p className="text-sm text-soft">Aucune purge n’a encore eu lieu.</p>
        ) : (
          <>
            <p className="text-sm text-soft">
              {DATE_FMT.format(last.at)}
              {typeof last.report.pages === 'number' && last.report.pages > 1
                ? ` · ${last.report.pages} lots`
                : ''}
              {last.report.truncated ? ' · interrompue avant la fin, la prochaine reprendra' : ''}
            </p>
            {purged.length === 0 ? (
              <p className="text-sm text-soft">Rien à effacer.</p>
            ) : (
              <ul className="text-sm text-soft">
                {purged.map(([key, n]) => (
                  <li key={key}>
                    {fmt.format(n)} {COUNT_LABELS[key] ?? key}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/** Admin-only settings: how long deleted records, events and the audit journal are kept. */
export function RetentionPage() {
  usePageTitle('Conservation');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Conservation" subtitle="Durées de conservation et purge nocturne" />
      <div className="mt-6">
        {user?.access.settings ? (
          <RetentionManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
