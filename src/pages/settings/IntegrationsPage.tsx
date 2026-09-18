import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth, useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  HelperText,
  Input,
  Label,
  PageHeader,
  Spinner,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Copy, Plug } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';

type Provider = 'google' | 'microsoft';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

const SCOPE_LABEL: Record<string, string> = {
  openid: 'Identité',
  email: 'Adresse e-mail',
  profile: 'Profil',
  offline_access: 'Accès hors connexion',
};

/** What the callback reports in `?error=` (ours, or the provider's own code) and what finishing may refuse. */
const CONNECTION_ERRORS: Record<string, string> = {
  invalid_state: 'La demande de connexion a expiré ou n’est pas valide. Recommencez.',
  invalid_finish: 'La demande de connexion a expiré ou n’est pas valide. Recommencez.',
  account_mismatch:
    'Cette connexion a été démarrée par un autre utilisateur : le compte n’a pas été lié.',
  access_denied: 'Vous avez refusé l’accès chez le fournisseur.',
  no_refresh_token:
    'Le fournisseur n’a pas accordé d’accès durable. Retirez l’accès de cette application dans votre compte, puis recommencez.',
  provider_not_configured: 'Ce fournisseur n’est pas configuré.',
  no_account_identity: 'Le fournisseur n’a pas indiqué de quel compte il s’agit.',
};

const appSchema = z
  .object({
    clientId: z.string().trim().max(300, 'Identifiant trop long.'),
    clientSecret: z.string().max(500, 'Secret trop long.'),
    hasClientSecret: z.boolean(),
    enabled: z.boolean(),
  })
  .refine((app) => !app.enabled || app.clientId.length > 0, {
    path: ['clientId'],
    message: 'L’identifiant client est requis pour activer ce fournisseur.',
  })
  .refine((app) => !app.enabled || app.hasClientSecret || app.clientSecret.length > 0, {
    path: ['clientSecret'],
    message: 'Le secret client est requis pour activer ce fournisseur.',
  });
type AppForm = z.infer<typeof appSchema>;

/** The deployment's own OAuth apps; shown to users holding the settings permission. */
function ProviderApps() {
  const config = useAuthQuery(api.features.config.queries.getAdminConfig, {});
  const updateConfig = useAuthMutation(api.features.config.mutations.updateConfig);
  const [forms, setForms] = useState<Record<string, AppForm> | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!config || forms) return;
    setForms(
      Object.fromEntries(
        config.connectors.map((c) => [
          c.provider,
          {
            clientId: c.clientId,
            clientSecret: '',
            hasClientSecret: c.hasClientSecret,
            enabled: c.enabled,
          },
        ]),
      ),
    );
  }, [config, forms]);

  if (!config || !forms) return <Spinner size="sm" />;

  const errorsOf = (provider: string): Partial<Record<keyof AppForm, string>> => {
    if (!submitted) return {};
    const parsed = appSchema.safeParse(forms[provider]);
    if (parsed.success) return {};
    const errors: Partial<Record<keyof AppForm, string>> = {};
    for (const issue of parsed.error.issues)
      errors[issue.path[0] as keyof AppForm] ??= issue.message;
    return errors;
  };
  const patch = (provider: string, change: Partial<AppForm>) =>
    setForms((f) => (f ? { ...f, [provider]: { ...(f[provider] as AppForm), ...change } } : f));

  const save = async () => {
    setSubmitted(true);
    if (config.connectors.some((c) => !appSchema.safeParse(forms[c.provider]).success)) return;
    setBusy(true);
    try {
      await updateConfig({
        connectors: config.connectors.map((c) => {
          const form = forms[c.provider] as AppForm;
          return {
            provider: c.provider,
            clientId: form.clientId.trim(),
            clientSecret: form.clientSecret || undefined,
            enabled: form.enabled,
          };
        }),
      });
      toast.success('Applications OAuth enregistrées.');
      setForms(null);
      setSubmitted(false);
    } catch (error) {
      toast.error(describeError(error, 'Échec de l’enregistrement.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    // The clipboard is refused outside a secure context.
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Adresse copiée.');
    } catch {
      toast.error('Copie impossible : sélectionnez l’adresse à la main.');
    }
  };

  return (
    <section className="mt-10 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Applications OAuth de votre organisation</h2>
        <p className="text-sm text-soft">
          Pour connecter des comptes avec vos propres identifiants, créez une application chez le
          fournisseur et déclarez-y l’adresse de redirection ci-dessous.
        </p>
      </div>
      {config.connectors.map((c) => {
        const form = forms[c.provider] as AppForm;
        const errors = errorsOf(c.provider);
        return (
          <div key={c.provider} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{c.label}</span>
              <div className="flex items-center gap-2">
                <Label htmlFor={`connector-${c.provider}-enabled`} className="text-xs text-soft">
                  Activer
                </Label>
                <Switch
                  id={`connector-${c.provider}-enabled`}
                  checked={form.enabled}
                  onCheckedChange={(enabled) => patch(c.provider, { enabled })}
                />
              </div>
            </div>
            {c.source === 'managed' && (
              <p className="text-xs text-soft">
                Des identifiants sont déjà fournis par votre hébergeur : cette configuration est
                facultative et, une fois activée, les remplace.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`connector-${c.provider}-id`}>Identifiant client</Label>
                <Input
                  id={`connector-${c.provider}-id`}
                  value={form.clientId}
                  onChange={(e) => patch(c.provider, { clientId: e.target.value })}
                  aria-invalid={errors.clientId !== undefined}
                />
                {errors.clientId ? (
                  <HelperText variant="error">{errors.clientId}</HelperText>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`connector-${c.provider}-secret`}>Secret client</Label>
                <Input
                  id={`connector-${c.provider}-secret`}
                  type="password"
                  autoComplete="off"
                  placeholder={form.hasClientSecret ? '•••••••• (inchangé)' : ''}
                  value={form.clientSecret}
                  onChange={(e) => patch(c.provider, { clientSecret: e.target.value })}
                  aria-invalid={errors.clientSecret !== undefined}
                />
                {errors.clientSecret ? (
                  <HelperText variant="error">{errors.clientSecret}</HelperText>
                ) : null}
              </div>
            </div>
            {c.redirectUri && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{c.redirectUri}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copy(c.redirectUri as string)}
                  aria-label="Copier l’adresse de redirection"
                >
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
        );
      })}
      <Button onClick={save} disabled={busy}>
        Enregistrer
      </Button>
    </section>
  );
}

/** Each user's connected accounts (Google, Microsoft), and for admins the organisation's OAuth apps. */
export function IntegrationsPage() {
  usePageTitle('Intégrations');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const overview = useAuthQuery(api.features.connectors.queries.overview, {});
  const startConnection = useAuthMutation(api.features.connectors.mutations.startConnection);
  const disconnect = useAuthMutation(api.features.connectors.mutations.disconnect);
  const finishConnection = useAuthMutation(api.features.connectors.mutations.finishConnection);
  const finishing = useRef<string | null>(null);
  const [toDisconnect, setToDisconnect] = useState<{ provider: Provider; label: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<Provider | null>(null);

  // The callback lands here with a one-time token (in the fragment) to claim the account, or an error; then the address is cleaned.
  useEffect(() => {
    const finish = new URLSearchParams(hash.slice(1)).get('finish');
    const error = params.get('error');
    if (!finish && !error) return;
    const failed = (code: string | null) =>
      toast.error(CONNECTION_ERRORS[code ?? ''] ?? 'La connexion a échoué. Recommencez.');
    // StrictMode runs the effect twice, the token is good once.
    if (finish && finishing.current !== finish) {
      finishing.current = finish;
      finishConnection({ token: finish })
        .then((outcome) => (outcome.ok ? toast.success('Compte connecté.') : failed(outcome.error)))
        .catch(() => failed(null));
    } else if (!finish) failed(error);
    navigate('/settings/integrations', { replace: true });
  }, [params, hash, navigate, finishConnection]);

  const connect = async (provider: Provider) => {
    setBusy(provider);
    try {
      const { url } = await startConnection({ provider });
      window.location.assign(url);
    } catch (error) {
      toast.error(describeError(error, 'Impossible de démarrer la connexion.'));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Intégrations"
        subtitle="Connectez votre compte Google ou Microsoft au CRM"
      />
      <div className="mt-6">
        {overview === undefined ? (
          <Spinner size="sm" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {overview.map((p) => (
              <li key={p.provider} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Plug className="mt-0.5 size-4 shrink-0 text-soft" aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">{p.label}</span>
                      {p.account ? (
                        <StatusBadge tone={p.account.status === 'active' ? 'green' : 'red'}>
                          {p.account.status === 'active' ? 'Connecté' : 'À reconnecter'}
                        </StatusBadge>
                      ) : p.source === null ? (
                        <StatusBadge tone="gray">Non configuré</StatusBadge>
                      ) : null}
                    </div>
                    {p.account ? (
                      <>
                        <p className="text-xs text-soft">
                          {p.account.email ?? 'Compte connecté'} · depuis le{' '}
                          {DATE_FMT.format(p.account.connectedAt)}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {p.account.scopes.map((scope) => (
                            <Badge key={scope} variant="secondary">
                              {SCOPE_LABEL[scope] ?? scope}
                            </Badge>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-soft">
                        {p.source === null
                          ? 'Un administrateur doit d’abord configurer ce fournisseur.'
                          : 'Aucun compte connecté.'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.account && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToDisconnect({ provider: p.provider, label: p.label })}
                    >
                      Déconnecter
                    </Button>
                  )}
                  {p.source !== null && p.account?.status !== 'active' && (
                    <Button size="sm" onClick={() => connect(p.provider)} disabled={busy !== null}>
                      {p.account ? 'Reconnecter' : 'Connecter'}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {user?.access?.settings ? <ProviderApps /> : null}

      <ConfirmDialog
        open={toDisconnect !== null}
        onOpenChange={(o) => !o && setToDisconnect(null)}
        title={`Déconnecter votre compte ${toDisconnect?.label ?? ''} ?`}
        description="L’accès accordé au CRM est révoqué chez le fournisseur lorsque celui-ci le permet, et les jetons sont supprimés."
        confirmLabel="Déconnecter"
        destructive
        onConfirm={async () => {
          if (!toDisconnect) return;
          try {
            await disconnect({ provider: toDisconnect.provider });
            toast.success('Compte déconnecté.');
          } catch (error) {
            toast.error(describeError(error, 'Échec de la déconnexion.'));
          }
          setToDisconnect(null);
        }}
      />
    </div>
  );
}
