import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { Button, HelperText, Input, Label, Spinner, Switch, toast } from '@crm/design-system';
import { Copy } from 'lucide-react';

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
export function ProviderApps() {
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
