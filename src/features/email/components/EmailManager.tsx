import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import {
  Button,
  Card,
  Input,
  Label,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@crm/design-system';
import type { Draft } from '../types';
import { BrevoSettings } from './BrevoSettings';
import { SmtpSettings } from './SmtpSettings';

export function EmailManager() {
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

  // Secrets are write-only and start empty: an untouched field is sent as undefined and the server keeps the stored value.
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

  // One save persists the whole config, so it lives outside the tabs.
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
      {/* The sender is the "From" of every e-mail, whatever the provider below. */}
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

        {/* The Brevo account always powers SMS, and e-mail only when the toggle below is on. */}
        <TabsContent value="brevo" className="space-y-6">
          <BrevoSettings draft={draft} email={email} isSmtp={isSmtp} set={set} />
        </TabsContent>

        {/* SMTP TAB — e-mail only; enabling it turns Brevo e-mail off. */}
        <TabsContent value="smtp" className="space-y-6">
          <SmtpSettings draft={draft} email={email} isSmtp={isSmtp} set={set} />
        </TabsContent>
      </Tabs>

      {/* The test goes through the saved config, not the draft, and shows the provider's exact response so a failure is not silent. */}
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
