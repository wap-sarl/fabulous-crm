import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import { Button, Card, PageHeader, Spinner } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';
import { AuthMethodsStep } from '../setup/steps/AuthMethodsStep';
import {
  type AuthMethodsData,
  socialDraftToConfig,
  ssoDraftToConfig,
  ssoDraftsError,
} from '../setup/steps/types';

/** The sign-in methods after the wizard: the same editor, the stored secrets never shown and kept when their field stays empty. */
function AuthManager() {
  const config = useQuery(api.features.config.queries.getAdminConfig);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const [draft, setDraft] = useState<AuthMethodsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config || draft) return;
    setDraft({
      magicLinkEnabled: config.auth.magicLinkEnabled,
      socialProviders: config.auth.socialProviders.map((p) => ({
        id: p.id,
        label: p.label,
        clientId: p.clientId,
        clientSecret: '',
        enabled: p.enabled,
      })),
      ssoProviders: config.auth.ssoProviders.map((p) => ({
        providerId: p.providerId,
        label: p.label,
        issuerUrl: p.issuerUrl,
        clientId: p.clientId,
        clientSecret: '',
        scopes: p.scopes.join(' '),
        enabled: p.enabled,
      })),
    });
  }, [config, draft]);

  if (config === undefined || (config && !draft)) return <Spinner size="sm" />;
  if (!config || !draft) return <p className="text-sm text-soft">Configuration introuvable.</p>;

  const storedSecret = new Set([
    ...config.auth.socialProviders.filter((p) => p.hasClientSecret).map((p) => `social:${p.id}`),
    ...config.auth.ssoProviders.filter((p) => p.hasClientSecret).map((p) => `sso:${p.providerId}`),
  ]);

  // The wizard's rules, except that a stored secret satisfies « secret required ».
  const validate = (): string | null => {
    const enabledSocial = draft.socialProviders.filter((s) => s.enabled);
    const enabledSso = draft.ssoProviders.filter((p) => p.enabled);
    if (!draft.magicLinkEnabled && enabledSocial.length === 0 && enabledSso.length === 0) {
      return 'Activez au moins une méthode de connexion.';
    }
    for (const s of enabledSocial) {
      if (!s.clientId.trim()) return `Client ID manquant pour ${s.label}.`;
      if (!s.clientSecret.trim() && !storedSecret.has(`social:${s.id}`)) {
        return `Client secret manquant pour ${s.label}.`;
      }
    }
    const ssoError = ssoDraftsError(
      draft.ssoProviders.map((p) =>
        p.clientSecret.trim() || !storedSecret.has(`sso:${p.providerId}`)
          ? p
          : { ...p, clientSecret: 'stored' },
      ),
    );
    return ssoError;
  };

  const handleSave = async () => {
    setSuccess(false);
    const invalid = validate();
    setError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      await updateConfig({
        magicLinkEnabled: draft.magicLinkEnabled,
        socialProviders: draft.socialProviders
          .filter((d) => d.enabled || d.clientId.trim() || d.clientSecret.trim())
          .map(socialDraftToConfig),
        ssoProviders: draft.ssoProviders
          .filter((d) => d.enabled || d.label.trim() || d.clientId.trim())
          .map(ssoDraftToConfig),
      });
      // Seeded again from the server: the secret fields empty, the presence flags fresh.
      setDraft(null);
      setSuccess(true);
    } catch {
      setError("L'enregistrement a échoué. Veuillez réessayer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-6 p-6">
      <p className="text-sm text-soft">
        Les secrets enregistrés ne sont jamais affichés : laissez le champ vide pour conserver la
        valeur actuelle.
      </p>
      <AuthMethodsStep
        data={draft}
        update={(patch) => {
          setDraft((d) => (d ? { ...d, ...patch } : d));
          setSuccess(false);
        }}
        error={error}
      />
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={busy}>
          Enregistrer
        </Button>
        {success && (
          <span className="text-sm text-success" role="status">
            Modifications enregistrées.
          </span>
        )}
      </div>
    </Card>
  );
}

/** Admin-only: magic link, social providers and SSO, editable after the setup wizard. */
export function AuthPage() {
  usePageTitle('Connexion');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Connexion" subtitle="Méthodes de connexion et fournisseurs OAuth" />
      <div className="mt-6">
        {user?.access.settings ? (
          <AuthManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
