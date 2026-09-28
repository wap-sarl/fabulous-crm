import { useEffect, useState } from 'react';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { z } from 'zod';
import {
  api,
  TRACKING_RETENTION_BOUNDS,
  type TrackingMode,
  trackingOriginsSchema,
  trackingPrivacyUrlSchema,
  VISITED_PAGES_MAX,
} from '@crm/lib/backend';
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
  Textarea,
  toast,
} from '@crm/design-system';
import { convexSiteUrl } from '../../lib/convexSite';
import { usePageTitle } from '../../layouts/DashboardShell';

const schema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['anonymous', 'named']),
    origins: z
      .string()
      .transform((text) => text.split(/\s+/).filter(Boolean))
      .pipe(trackingOriginsSchema),
    privacyUrl: z
      .string()
      .trim()
      .pipe(z.union([z.literal(''), trackingPrivacyUrlSchema])),
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
  })
  .superRefine((value, ctx) => {
    if (!value.enabled) return;
    if (value.origins.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['origins'], message: 'Indiquez au moins un site.' });
    }
    if (value.mode === 'named' && !value.privacyUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['privacyUrl'],
        message: 'Le suivi nominatif demande un lien vers votre politique de confidentialité.',
      });
    }
  });
type Form = {
  enabled: boolean;
  mode: TrackingMode;
  origins: string;
  privacyUrl: string;
  retentionDays: string;
};
type Field = 'origins' | 'privacyUrl' | 'retentionDays';
type Counts = {
  visitors: number;
  visitorsCapped: boolean;
  identified: number;
  identifiedCapped: boolean;
};

const fmt = new Intl.NumberFormat('fr-FR');
const count = (n: number, capped: boolean) => (capped ? `Plus de ${fmt.format(n)}` : fmt.format(n));

/** « Suivi web »: the switch, the sites, the mode, the retention, the snippet. */
export function TrackingPage() {
  usePageTitle('Suivi web');
  const convex = useConvex();
  const settings = useQuery(api.features.tracking.queries.getTrackingSettings);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const [form, setForm] = useState<Form | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = settings !== undefined;

  useEffect(() => {
    if (settings && !form) {
      setForm({
        enabled: settings.enabled,
        mode: settings.mode,
        origins: settings.allowedOrigins.join('\n'),
        privacyUrl: settings.privacyUrl ?? '',
        retentionDays: String(settings.retentionDays),
      });
    }
  }, [settings, form]);

  // Asked once: a subscription would rerun the count at every new browser.
  useEffect(() => {
    if (!ready) return;
    convex
      .query(api.features.tracking.queries.getTrackingCounts, {})
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [convex, ready]);

  if (!settings || !form) {
    return (
      <div className="flex justify-center p-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const parsed = schema.safeParse(form);
  const errors: Partial<Record<Field, string>> = {};
  if (submitted && !parsed.success) {
    for (const issue of parsed.error.issues) errors[issue.path[0] as Field] ??= issue.message;
  }
  const leavingNamed = settings.mode === 'named' && form.mode === 'anonymous';

  const save = async () => {
    setSubmitted(true);
    if (!parsed.success) return;
    setBusy(true);
    try {
      await updateConfig({
        trackingEnabled: parsed.data.enabled,
        trackingMode: parsed.data.mode,
        trackingRetentionDays: parsed.data.retentionDays,
        trackingAllowedOrigins: parsed.data.origins,
        trackingPrivacyUrl: parsed.data.privacyUrl || null,
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
                navigateur envoie « Global Privacy Control » ou « Do Not Track ». L’accord est
                redemandé tous les six mois.
              </HelperText>
            </div>
            <Switch
              id="tracking-enabled"
              checked={form.enabled}
              onCheckedChange={(enabled) => setForm({ ...form, enabled })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tracking-origins">Sites suivis</Label>
            <Textarea
              id="tracking-origins"
              rows={3}
              placeholder={'https://www.exemple.fr\nhttps://exemple.fr'}
              value={form.origins}
              onChange={(e) => setForm({ ...form, origins: e.target.value })}
              aria-invalid={errors.origins !== undefined}
            />
            {errors.origins ? (
              <HelperText variant="error">{errors.origins}</HelperText>
            ) : (
              <HelperText>
                Une adresse par ligne. Les pages vues venant d’un autre site sont refusées. Le
                cookie est propre à chaque adresse : <code>www.exemple.fr</code> et{' '}
                <code>exemple.fr</code> comptent pour deux navigateurs, redirigez l’une vers
                l’autre.
              </HelperText>
            )}
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
                ? 'Les pages vues sont rattachées au contact dès qu’il soumet un formulaire ou clique un lien de campagne menant à un site suivi, celles d’avant comprises. Un e-mail transféré identifie celui qui clique comme le destinataire d’origine. Ce suivi nominatif demande une base légale et une information claire : à valider avant de l’activer.'
                : 'Rien n’est rattaché à un contact nommé : les pages vues restent celles d’un navigateur anonyme.'}
            </HelperText>
            {leavingNamed && (
              <HelperText variant="error">
                Quitter le mode nominatif détache les pages vues de tous les contacts ; revenir au
                nominatif ne les rattache pas.
              </HelperText>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="tracking-privacy">Politique de confidentialité (lien du bandeau)</Label>
            <Input
              id="tracking-privacy"
              type="url"
              placeholder="https://www.exemple.fr/confidentialite"
              value={form.privacyUrl}
              onChange={(e) => setForm({ ...form, privacyUrl: e.target.value })}
              aria-invalid={errors.privacyUrl !== undefined}
            />
            {errors.privacyUrl ? (
              <HelperText variant="error">{errors.privacyUrl}</HelperText>
            ) : (
              <HelperText>
                Obligatoire en mode nominatif : le bandeau annonce alors le rattachement à la fiche
                de contact et renvoie à cette page.
              </HelperText>
            )}
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
              aria-invalid={errors.retentionDays !== undefined}
              className="w-40"
            />
            {errors.retentionDays ? (
              <HelperText variant="error">{errors.retentionDays}</HelperText>
            ) : (
              <HelperText>
                La purge nocturne efface les pages vues et les navigateurs inactifs plus anciens ;
                le filtre « Pages visitées » d’un contact suit, sur ses {VISITED_PAGES_MAX} derniers
                chemins distincts.
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
            sur votre domaine, pour treize mois, après l’accord, et retiré si l’accord l’est. Un
            site avec son propre bandeau définit{' '}
            <code>
              window.wapTracking = {'{'} consent: true {'}'}
            </code>{' '}
            avant le script, ou appelle <code>window.wapTrack.consent(true)</code> quand le visiteur
            accepte et <code>window.wapTrack.consent(false)</code> quand il se ravise.
          </p>
          {counts && (
            <p className="text-xs text-faint">
              {count(counts.visitors, counts.visitorsCapped)} navigateur(s) vu(s),{' '}
              {count(counts.identified, counts.identifiedCapped)} rattaché(s) à un contact.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
