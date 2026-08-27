import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import {
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';

type Provider = 'brevo' | 'smtp';

/** Local edit state. Secret fields hold '' when unchanged (kept server-side). */
type Draft = {
  senderEmail: string;
  senderName: string;
  provider: Provider;
  brevoApiKey: string;
  brevoWebhookSecret: string;
  brevoSmsSender: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
};

/** A masked, write-only secret input: shows "saved" placeholder, sends only if typed. */
function SecretField({
  label,
  value,
  hasStored,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  hasStored: boolean;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="password"
        autoComplete="off"
        value={value}
        placeholder={hasStored ? '•••••••••• (enregistré)' : 'Non configuré'}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The "use this provider for e-mail" switch. The two are mutually exclusive:
 *  turning one on turns the other off (email `provider` is a single value). */
function EmailEnableToggle({
  label,
  checked,
  onEnable,
}: {
  label: string;
  checked: boolean;
  onEnable: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch
        checked={checked}
        // Only enabling changes the provider; you disable by enabling the other.
        onCheckedChange={(v) => v && onEnable()}
        aria-label={label}
      />
      <span className="text-sm font-medium text-ink">{label}</span>
    </div>
  );
}

function EmailManager() {
  const config = useQuery(api.features.config.queries.getAdminConfig);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const sendTestEmail = useAction(api.features.email.actions.sendTestEmail);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diagnostic "send test email" — surfaces the provider's real response.
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    provider?: string;
    from?: { name: string; email: string };
    status?: number;
    error?: string;
    messageId?: string;
  } | null>(null);

  const handleTest = async () => {
    const to = testTo.trim();
    if (!to) return;
    setTesting(true);
    setTestResult(null);
    try {
      const r = await sendTestEmail({ to });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const email = config?.email;

  // Seed the draft from the persisted config once it loads. Secrets start empty
  // (write-only) — an untouched field is sent as undefined and the stored value
  // is preserved server-side.
  useEffect(() => {
    if (!config || draft) return;
    setDraft({
      senderEmail: config.senderEmail,
      senderName: config.senderName,
      provider: config.email.provider,
      brevoApiKey: '',
      brevoWebhookSecret: '',
      brevoSmsSender: config.email.brevoSmsSender,
      smtpHost: config.email.smtpHost,
      smtpPort: config.email.smtpPort != null ? String(config.email.smtpPort) : '',
      smtpSecure: config.email.smtpSecure,
      smtpUser: config.email.smtpUser,
      smtpPass: '',
    });
  }, [config, draft]);

  if (config === undefined || !draft || !email) return <Spinner size="sm" />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setSuccess(false);
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(false);

    const senderEmail = draft.senderEmail.trim();
    if (!senderEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      setError("L'adresse d'expéditeur doit être un e-mail valide.");
      return;
    }
    if (!draft.senderName.trim()) {
      setError("Le nom de l'expéditeur est requis.");
      return;
    }

    const port = draft.smtpPort.trim() ? Number(draft.smtpPort) : undefined;
    if (draft.provider === 'smtp' && (!draft.smtpHost.trim() || !port)) {
      setError('Le serveur SMTP nécessite au minimum un hôte et un port.');
      return;
    }
    if (port !== undefined && (!Number.isInteger(port) || port <= 0)) {
      setError('Le port SMTP doit être un entier positif.');
      return;
    }

    setBusy(true);
    try {
      await updateConfig({
        senderEmail: draft.senderEmail,
        senderName: draft.senderName,
        email: {
          provider: draft.provider,
          // Empty secret → undefined → server keeps the stored value.
          brevoApiKey: draft.brevoApiKey || undefined,
          brevoWebhookSecret: draft.brevoWebhookSecret || undefined,
          brevoSmsSender: draft.brevoSmsSender,
          smtpHost: draft.smtpHost,
          smtpPort: port,
          smtpSecure: draft.smtpSecure,
          smtpUser: draft.smtpUser,
          smtpPass: draft.smtpPass || undefined,
        },
      });
      // Clear typed secrets so they revert to the masked "saved" state.
      setDraft((d) => (d ? { ...d, brevoApiKey: '', brevoWebhookSecret: '', smtpPass: '' } : d));
      setSuccess(true);
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('smtp_config_incomplete')
          ? 'Configuration SMTP incomplète (hôte et port requis).'
          : "L'enregistrement a échoué. Veuillez réessayer.",
      );
    } finally {
      setBusy(false);
    }
  };

  const isSmtp = draft.provider === 'smtp';

  // One Save persists the whole config, so it lives outside the tabs and applies
  // to both providers' settings at once.
  const saveRow = (
    <div className="flex items-center gap-3">
      <Button onClick={handleSave} loading={busy}>
        Enregistrer
      </Button>
      {success && (
        <span className="text-sm text-success" role="status">
          Modifications enregistrées.
        </span>
      )}
      {error && (
        <span className="text-sm text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sender identity — the "From" for every e-mail (campaigns, invitations,
          sign-in), independent of the provider below. */}
      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">Expéditeur des e-mails</h2>
          <p className="text-xs text-muted-foreground">
            Adresse « De » utilisée pour tous les e-mails (campagnes, invitations, connexion). Le
            domaine doit être un expéditeur vérifié chez Brevo, sinon l'envoi est refusé.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sender-name">Nom de l'expéditeur</Label>
            <Input
              id="sender-name"
              value={draft.senderName}
              onChange={(e) => set('senderName', e.target.value)}
              placeholder="ex. WAP CRM"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sender-email">E-mail de l'expéditeur</Label>
            <Input
              id="sender-email"
              type="email"
              autoComplete="off"
              value={draft.senderEmail}
              onChange={(e) => set('senderEmail', e.target.value)}
              placeholder="ex. contact@votredomaine.fr"
            />
          </div>
        </div>
      </Card>

      <Tabs defaultValue={isSmtp ? 'smtp' : 'brevo'} className="space-y-6">
        <TabsList>
          <TabsTrigger value="brevo">Brevo</TabsTrigger>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
        </TabsList>

        {/* BREVO TAB — the Brevo account (key entered once): powers SMS always,
            and e-mail when the toggle below is on. */}
        <TabsContent value="brevo" className="space-y-6">
          <Card className="space-y-3 p-6">
            <EmailEnableToggle
              label="Utiliser Brevo pour l'envoi d'e-mails"
              checked={!isSmtp}
              onEnable={() => set('provider', 'brevo')}
            />
            <p className="text-xs text-muted-foreground">
              Un seul fournisseur d'e-mail est actif à la fois. Les SMS passent toujours par Brevo,
              quel que soit le fournisseur d'e-mail.
            </p>
          </Card>

          <Card className="space-y-5 p-6">
            <div>
              <h2 className="text-sm font-semibold text-ink">Compte Brevo</h2>
              <p className="text-xs text-muted-foreground">
                Utilisé pour les SMS et, si Brevo est activé ci-dessus, pour l'e-mail et son suivi.
              </p>
            </div>
            <SecretField
              label="Clé API Brevo"
              value={draft.brevoApiKey}
              hasStored={email.hasBrevoApiKey}
              onChange={(v) => set('brevoApiKey', v)}
            />
            <SecretField
              label="Secret du webhook Brevo"
              value={draft.brevoWebhookSecret}
              hasStored={email.hasBrevoWebhookSecret}
              onChange={(v) => set('brevoWebhookSecret', v)}
              hint="Authentifie les webhooks d'événements (ouvertures, clics, rebonds, STOP SMS)."
            />
            <div className="space-y-1.5">
              <Label htmlFor="brevo-sms-sender">Expéditeur SMS</Label>
              <Input
                id="brevo-sms-sender"
                value={draft.brevoSmsSender}
                maxLength={11}
                onChange={(e) => set('brevoSmsSender', e.target.value)}
                placeholder="ex. WAP-CRM (11 caractères max)"
              />
            </div>
          </Card>
        </TabsContent>

        {/* SMTP TAB — e-mail only; enabling it turns Brevo e-mail off. */}
        <TabsContent value="smtp" className="space-y-6">
          <Card className="space-y-3 p-6">
            <EmailEnableToggle
              label="Utiliser SMTP pour l'envoi d'e-mails"
              checked={isSmtp}
              onEnable={() => set('provider', 'smtp')}
            />
            {isSmtp ? (
              <p className="text-xs text-warning">
                En mode SMTP : les modèles Brevo, le suivi des ouvertures/clics/remises et les
                rebonds ne sont pas disponibles. Les liens de suivi restent fonctionnels.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Configurez le serveur ci-dessous, puis activez SMTP pour l'utiliser à la place de
                Brevo pour l'e-mail.
              </p>
            )}
          </Card>

          <Card className="space-y-5 p-6">
            <div>
              <h2 className="text-sm font-semibold text-ink">Serveur SMTP</h2>
              <p className="text-xs text-muted-foreground">
                L'adresse d'expéditeur est celle configurée ci-dessus (« Expéditeur des e-mails »).
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="smtp-host">Hôte</Label>
                <Input
                  id="smtp-host"
                  value={draft.smtpHost}
                  onChange={(e) => set('smtpHost', e.target.value)}
                  placeholder="smtp.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp-port">Port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={draft.smtpPort}
                  onChange={(e) => set('smtpPort', e.target.value)}
                  placeholder="587"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={draft.smtpSecure}
                onCheckedChange={(v) => set('smtpSecure', v)}
                aria-label="TLS implicite"
              />
              <div>
                <span className="text-sm font-medium text-ink">TLS implicite (port 465)</span>
                <p className="text-xs text-muted-foreground">
                  Activé pour le port 465 ; désactivé pour STARTTLS (587/25).
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="smtp-user">Utilisateur</Label>
                <Input
                  id="smtp-user"
                  autoComplete="off"
                  value={draft.smtpUser}
                  onChange={(e) => set('smtpUser', e.target.value)}
                  placeholder="Laisser vide pour un relais sans authentification"
                />
              </div>
              <SecretField
                label="Mot de passe"
                value={draft.smtpPass}
                hasStored={email.hasSmtpPass}
                onChange={(v) => set('smtpPass', v)}
              />
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Diagnostic — sends a real email through the SAVED config and shows the
          provider's exact response (status + error), so failures aren't silent. */}
      <Card className="space-y-4 p-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">Envoyer un e-mail de test</h2>
          <p className="text-xs text-muted-foreground">
            Utilise la configuration <strong>enregistrée</strong> (enregistrez d'abord). Affiche la
            réponse exacte du fournisseur — utile pour diagnostiquer un envoi qui échoue.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="test-to">Destinataire</Label>
            <Input
              id="test-to"
              type="email"
              autoComplete="off"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="vous@votredomaine.fr"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleTest}
            loading={testing}
            disabled={!testTo.trim()}
          >
            Envoyer le test
          </Button>
        </div>
        {testResult && (
          <div
            className={`rounded-lg border p-3 text-xs ${
              testResult.ok
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
            role="status"
          >
            {testResult.ok ? (
              <p>
                Accepté par le fournisseur ({testResult.provider}) — expéditeur{' '}
                <strong>{testResult.from?.email}</strong>
                {testResult.messageId ? `, messageId ${testResult.messageId}` : ''}. Si l'e-mail
                n'arrive pas, vérifiez le domaine expéditeur / les spams côté fournisseur.
              </p>
            ) : (
              <div className="space-y-1">
                <p>
                  Échec via {testResult.provider ?? 'le fournisseur'}
                  {testResult.status ? ` (HTTP ${testResult.status})` : ''} — expéditeur{' '}
                  <strong>{testResult.from?.email ?? '—'}</strong>.
                </p>
                {testResult.error && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
                    {testResult.error}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {saveRow}
    </div>
  );
}

/** Admin-only email/SMS delivery settings: Brevo account + SMTP provider. */
export function EmailPage() {
  usePageTitle('E-mail & SMS');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="E-mail & SMS" subtitle="Fournisseur d'envoi, clés Brevo et serveur SMTP" />
      <div className="mt-6">
        {user?.access.settings ? (
          <EmailManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
