import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { describeConnectionError } from '@crm/lib/connectors';
import { describeError } from '@crm/lib/errors';
import {
  Badge,
  Button,
  ConfirmDialog,
  PageHeader,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { Plug } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { ProviderApps } from '../../features/connectors/components/ProviderApps';

type Provider = 'google' | 'microsoft';

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

const SCOPE_LABEL: Record<string, string> = {
  openid: 'Identité',
  email: 'Adresse e-mail',
  profile: 'Profil',
  offline_access: 'Accès hors connexion',
};

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
  const claimFailure = useAuthMutation(api.features.connectors.mutations.claimFailure);
  const claiming = useRef<string | null>(null);
  const [toDisconnect, setToDisconnect] = useState<{ provider: Provider; label: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<Provider | null>(null);

  // The callback lands here with a one-time token in the fragment (the account to claim, or what the provider said), or an error code; then the address is cleaned.
  useEffect(() => {
    const fragment = new URLSearchParams(hash.slice(1));
    const finish = fragment.get('finish');
    const failedToken = fragment.get('failed');
    const error = params.get('error');
    if (!finish && !failedToken && !error) return;
    // Only a code is ever read from the address: free text comes from the server, claimed with the token.
    const failed = (code: string | null, providerDescription: string | null = null) => {
      const { message, description } = describeConnectionError(code, providerDescription);
      toast.error(message, description ? { description } : undefined);
    };
    const token = finish ?? failedToken;
    // StrictMode runs the effect twice, a token is good once.
    if (token && claiming.current !== token) {
      claiming.current = token;
      if (finish) {
        finishConnection({ token: finish })
          .then((outcome) =>
            outcome.ok ? toast.success('Compte connecté.') : failed(outcome.error),
          )
          .catch(() => failed(null));
      } else {
        claimFailure({ token })
          .then((failure) => failed(failure?.error ?? null, failure?.description ?? null))
          .catch(() => failed(null));
      }
    } else if (!token) failed(error);
    navigate('/settings/integrations', { replace: true });
  }, [params, hash, navigate, finishConnection, claimFailure]);

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
