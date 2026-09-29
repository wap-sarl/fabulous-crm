import { useState } from 'react';
import { Button, Input, Label, Switch } from '@crm/design-system';
import { Plus, Trash2, CheckCircle, Copy } from 'lucide-react';
import { usePublicConfig } from '@crm/widgets/config/ConfigContext';
import { slugOf } from '@crm/lib/backend';
import type { SsoDraft, SocialDraft, StepProps } from './types';
import { emptySsoProvider } from './types';

export function AuthMethodsStep({ data, update, error }: StepProps) {
  const { config } = usePublicConfig();
  const socialProviders = config?.auth.socialProviders ?? [];
  const callbackBase = config?.authCallbackBaseUrl?.replace(/\/+$/, '') ?? null;
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyCallback = async (id: string, url: string) => {
    try {
      await navigator.clipboard?.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // clipboard unavailable (insecure context) — the field is selectable anyway
    }
  };

  // Falls back to the catalog entry, so a provider never touched still renders empty inputs.
  const socialDraftFor = (id: string, label: string): SocialDraft =>
    data.socialProviders.find((s) => s.id === id) ?? {
      id,
      label,
      clientId: '',
      clientSecret: '',
      enabled: false,
    };

  const setSocial = (id: string, label: string, patch: Partial<SocialDraft>) => {
    const current = socialDraftFor(id, label);
    const nextDraft = { ...current, ...patch };
    const exists = data.socialProviders.some((s) => s.id === id);
    const next = exists
      ? data.socialProviders.map((s) => (s.id === id ? nextDraft : s))
      : [...data.socialProviders, nextDraft];
    update({ socialProviders: next });
  };

  const setSso = (index: number, patch: Partial<SsoDraft>) => {
    const next = data.ssoProviders.map((p, i) => (i === index ? { ...p, ...patch } : p));
    update({ ssoProviders: next });
  };

  const addSso = () => {
    update({ ssoProviders: [...data.ssoProviders, emptySsoProvider()] });
  };

  const removeSso = (index: number) => {
    update({ ssoProviders: data.ssoProviders.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div>
          <p className="font-medium text-ink">Lien magique par e-mail</p>
          <p className="text-sm text-soft">
            Connexion sans mot de passe via un lien envoyé par e-mail.
          </p>
        </div>
        <Switch
          checked={data.magicLinkEnabled}
          onCheckedChange={(v) => update({ magicLinkEnabled: v })}
          aria-label="Activer le lien magique"
        />
      </div>

      {/* Social provider credentials are stored in the database and resolved by createAuth at request time. */}
      <div className="space-y-3">
        <div>
          <p className="font-medium text-ink">Fournisseurs sociaux (Better Auth)</p>
          <p className="text-sm text-soft">
            Activez un fournisseur, saisissez son identifiant et son secret client, puis copiez
            l'URL de rappel dans la console du fournisseur.
          </p>
        </div>
        {socialProviders.map((provider) => {
          const draft = socialDraftFor(provider.id, provider.label);
          const callbackUrl = callbackBase
            ? `${callbackBase}/api/auth/callback/${provider.id}`
            : null;
          return (
            <div key={provider.id} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{provider.label}</span>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setSocial(provider.id, provider.label, { enabled: v })}
                  aria-label={`Activer ${provider.label}`}
                />
              </div>
              {draft.enabled && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Client ID</Label>
                      <Input
                        value={draft.clientId}
                        autoComplete="off"
                        onChange={(e) =>
                          setSocial(provider.id, provider.label, { clientId: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Client secret</Label>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={draft.clientSecret}
                        onChange={(e) =>
                          setSocial(provider.id, provider.label, { clientSecret: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  {callbackUrl && (
                    <div className="space-y-1.5">
                      <Label>URL de rappel (à copier dans la console du fournisseur)</Label>
                      <div className="flex items-center gap-2">
                        <Input value={callbackUrl} readOnly className="font-mono text-xs" />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => copyCallback(provider.id, callbackUrl)}
                          aria-label={`Copier l'URL de rappel ${provider.label}`}
                        >
                          {copiedId === provider.id ? (
                            <CheckCircle className="size-4" aria-hidden="true" />
                          ) : (
                            <Copy className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom SSO issuers go through Better Auth's generic-oauth plugin; the callback URL is built from the providerId slug. */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-ink">SSO personnalisé (Better Auth)</p>
            <p className="text-sm text-soft">
              Émetteurs OIDC personnalisés. L'émetteur doit exposer un document de découverte{' '}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                /.well-known/openid-configuration
              </code>
              .
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addSso}>
            <Plus className="mr-1 size-4" aria-hidden="true" />
            Ajouter
          </Button>
        </div>

        {data.ssoProviders.length === 0 && (
          <p className="text-sm text-faint">Aucun fournisseur SSO personnalisé configuré.</p>
        )}

        {data.ssoProviders.map((provider, index) => {
          const callbackUrl =
            callbackBase && provider.providerId
              ? `${callbackBase}/api/auth/oauth2/callback/${provider.providerId}`
              : null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: every field of a provider is typed here, its id included: only the place is stable
            <div key={index} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={provider.enabled}
                    onCheckedChange={(v) => setSso(index, { enabled: v })}
                    aria-label={`Activer ${provider.label || 'le fournisseur'}`}
                  />
                  <span className="text-sm font-semibold text-soft">
                    {provider.label || `Fournisseur ${index + 1}`}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSso(index)}
                  aria-label="Supprimer le fournisseur"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Libellé</Label>
                  <Input
                    value={provider.label}
                    placeholder="Mon organisation"
                    onChange={(e) =>
                      setSso(index, {
                        label: e.target.value,
                        // The slug follows the label until the user overrides it: the callback path depends on it.
                        providerId:
                          provider.providerId && provider.providerId !== slugOf(provider.label)
                            ? provider.providerId
                            : slugOf(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Identifiant (slug)</Label>
                  <Input
                    value={provider.providerId}
                    placeholder="mon-entreprise"
                    className="font-mono text-xs"
                    onChange={(e) => setSso(index, { providerId: e.target.value })}
                    onBlur={(e) => setSso(index, { providerId: slugOf(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>URL de l'émetteur (issuer)</Label>
                  <Input
                    value={provider.issuerUrl}
                    placeholder="https://sso.mon-entreprise.fr"
                    onChange={(e) => setSso(index, { issuerUrl: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client ID</Label>
                  <Input
                    value={provider.clientId}
                    autoComplete="off"
                    onChange={(e) => setSso(index, { clientId: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client secret</Label>
                  <Input
                    type="password"
                    autoComplete="off"
                    value={provider.clientSecret}
                    onChange={(e) => setSso(index, { clientSecret: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Scopes (séparés par des espaces)</Label>
                  <Input
                    value={provider.scopes}
                    placeholder="openid email profile"
                    className="font-mono text-xs"
                    onChange={(e) => setSso(index, { scopes: e.target.value })}
                  />
                </div>
              </div>

              {callbackUrl && (
                <div className="space-y-1.5">
                  <Label>URL de rappel (à copier dans la console du fournisseur)</Label>
                  <div className="flex items-center gap-2">
                    <Input value={callbackUrl} readOnly className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyCallback(provider.providerId, callbackUrl)}
                      aria-label="Copier l'URL de rappel"
                    >
                      {copiedId === provider.providerId ? (
                        <CheckCircle className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
