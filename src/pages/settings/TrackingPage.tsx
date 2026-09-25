import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { z } from 'zod';
import { api, TRACKING_RETENTION_BOUNDS, type TrackingMode } from '@crm/lib/backend';
import {
  Button,
  Card,
  HelperText,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  toast,
} from '@crm/design-system';
import { convexSiteUrl } from '../../lib/convexSite';
import { usePageTitle } from '../../layouts/DashboardShell';

const schema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['anonymous', 'named']),
  retentionDays: z.coerce
    .number({ message: 'Indiquez un nombre de jours.' })
    .int('Indiquez un nombre entier de jours.')
    .min(
      TRACKING_RETENTION_BOUNDS.min,
      `Entre ${TRACKING_RETENTION_BOUNDS.min} et ${TRACKING_RETENTION_BOUNDS.max} jours.`,
    )
    .max(
      TRACKING_RETENTION_BOUNDS.max,
      `Entre ${TRACKING_RETENTION_BOUNDS.min} et ${TRACKING_RETENTION_BOUNDS.max} jours.`,
    ),
});
type Form = { enabled: boolean; mode: TrackingMode; retentionDays: string };

const fmt = new Intl.NumberFormat('fr-FR');

/** « Suivi web »: the switch, the mode, the retention, the snippet. */
export function TrackingPage() {
  usePageTitle('Suivi web');
  const settings = useQuery(api.features.tracking.queries.getTrackingSettings);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const [form, setForm] = useState<Form | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings && !form) {
      setForm({
        enabled: settings.enabled,
        mode: settings.mode,
        retentionDays: String(settings.retentionDays),
      });
    }
  }, [settings, form]);

  if (!settings || !form) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const parsed = schema.safeParse(form);
  const retentionError =
    submitted && !parsed.success
      ? parsed.error.issues.find((i) => i.path[0] === 'retentionDays')?.message
      : undefined;

  const save = async () => {
    setSubmitted(true);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await updateConfig({
        trackingEnabled: parsed.data.enabled,
        trackingMode: parsed.data.mode,
        trackingRetentionDays: parsed.data.retentionDays,
      });
      toast.success('Suivi web enregistré.');
      setSubmitted(false);
    } catch {
      toast.error('L’enregistrement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const snippet = `<script src="${convexSiteUrl()}/track.js" async></script>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      toast.success('Copié.');
    } catch {
      toast.error('Impossible de copier.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Suivi web"
        subtitle="Les pages que vos contacts visitent sur votre site, avec leur accord"
      />
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="tracking-enabled">Suivi activé</Label>
              <HelperText>
                Le script ne démarre qu’après l’accord du visiteur (bandeau fourni, ou votre propre
                gestionnaire de consentement via <code>window.wapTracking</code>), et jamais si le
                navigateur envoie « Do Not Track ».
              </HelperText>
            </div>
            <Switch
              id="tracking-enabled"
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm({ ...form, enabled })}
            />
          </div>
          <div className="space-y-1">
            <Label>Mode</Label>
            <Select
              value={form.mode}
              onValueChange={(mode) => setForm({ ...form, mode: mode as TrackingMode })}
            >
              <SelectTrigger className="h-9 w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anonymous">Anonyme : fréquentation seulement</SelectItem>
                <SelectItem value="named">Nominatif : rattaché aux contacts</SelectItem>
              </SelectContent>
            </Select>
            <HelperText>
              {form.mode === 'named'
                ? 'Les pages vues sont rattachées au contact dès qu’il soumet un formulaire ou clique un lien de campagne, celles d’avant comprises. Ce suivi nominatif demande une base légale et une information claire : à valider avant de l’activer.'
                : 'Rien n’est rattaché à un contact nommé : les pages vues restent celles d’un navigateur anonyme.'}
            </HelperText>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tracking-retention">Conservation des pages vues (jours)</Label>
            <Input
              id="tracking-retention"
              type="number"
              min={TRACKING_RETENTION_BOUNDS.min}
              max={TRACKING_RETENTION_BOUNDS.max}
              value={form.retentionDays}
              onChange={(e) => setForm({ ...form, retentionDays: e.target.value })}
              aria-invalid={retentionError !== undefined}
              className="w-40"
            />
            {retentionError ? (
              <HelperText variant="error">{retentionError}</HelperText>
            ) : (
              <HelperText>
                La purge nocturne efface les pages vues et les navigateurs inactifs plus anciens.
              </HelperText>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={save} loading={busy}>
              Enregistrer
            </Button>
          </div>
        </Card>

        <Card className="space-y-3 p-6">
          <h2 className="text-sm font-semibold">Script à insérer sur votre site</h2>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-[#F2F3F5] px-2 py-1.5 font-mono text-xs text-body">
              {snippet}
            </code>
            <Button variant="outline" size="sm" onClick={copy}>
              Copier
            </Button>
          </div>
          <p className="text-xs text-faint">
            Dans le <code>&lt;head&gt;</code> de chaque page. Le cookie <code>_wapv</code> est posé
            sur votre domaine, pour treize mois, après l’accord. Un site avec son propre bandeau
            définit{' '}
            <code>
              window.wapTracking = {'{'} consent: true {'}'}
            </code>{' '}
            avant le script, ou appelle <code>window.wapTrack.consent(true)</code> quand le visiteur
            accepte.
          </p>
          <p className="text-xs text-faint">
            {settings.visitorsCapped ? 'Plus de 1 000' : fmt.format(settings.visitors)}{' '}
            navigateur(s) vu(s), {fmt.format(settings.identified)} rattaché(s) à un contact.
          </p>
        </Card>
      </div>
    </div>
  );
}
