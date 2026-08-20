import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import {
  useAuth,
  ImageUploadField,
  ColorPickerField,
  applyPrimaryColor,
  resetPrimaryColor,
} from '@crm/widgets';
import { Button, Card, PageHeader, Spinner } from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';

function BrandingManager() {
  const config = useQuery(api.features.config.queries.getAdminConfig);
  const generateUploadUrl = useMutation(api.features.config.mutations.generateUploadUrl);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);

  // Uploaded storage ids / picked color not yet persisted.
  const [pending, setPending] = useState<{
    logoStorageId?: Id<'_storage'>;
    faviconStorageId?: Id<'_storage'>;
    primaryColor?: string;
  }>({});
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revert an unsaved color preview when leaving the page. BrandingHead only
  // re-applies when the persisted config changes, so without this a previewed
  // color would linger app-wide until reload.
  const persisted = config?.primaryColor ?? null;
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  useEffect(
    () => () => {
      if (persistedRef.current) applyPrimaryColor(persistedRef.current);
      else resetPrimaryColor();
    },
    []
  );

  const getUploadUrl = () => generateUploadUrl({});
  const hasPending = !!(
    pending.logoStorageId ||
    pending.faviconStorageId ||
    pending.primaryColor
  );

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await updateConfig(pending);
      setPending({});
      setSuccess(true);
    } catch {
      setError("L'enregistrement a échoué. Veuillez réessayer.");
    } finally {
      setBusy(false);
    }
  };

  if (config === undefined) return <Spinner size="sm" />;

  return (
    <Card className="space-y-6 p-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ImageUploadField
          label="Logo"
          shape="wide"
          hint="PNG ou SVG, fond transparent recommandé."
          currentUrl={config?.logoUrl}
          onGetUploadUrl={getUploadUrl}
          onUploaded={(storageId) => {
            setPending((p) => ({ ...p, logoStorageId: storageId }));
            setSuccess(false);
          }}
        />
        <ImageUploadField
          label="Favicon"
          shape="square"
          accept={['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']}
          hint="PNG, SVG ou ICO carré (32×32 ou plus)."
          currentUrl={config?.faviconUrl}
          onGetUploadUrl={getUploadUrl}
          onUploaded={(storageId) => {
            setPending((p) => ({ ...p, faviconStorageId: storageId }));
            setSuccess(false);
          }}
        />
      </div>

      <ColorPickerField
        label="Couleur d'accentuation"
        hint="Appliquée aux boutons, liens et éléments actifs de l'interface."
        value={pending.primaryColor ?? config?.primaryColor ?? null}
        onChange={(hex) => {
          applyPrimaryColor(hex); // live preview
          setPending((p) => ({ ...p, primaryColor: hex }));
          setSuccess(false);
        }}
      />

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} loading={busy} disabled={!hasPending}>
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
    </Card>
  );
}

/** Admin-only branding settings: upload/replace the logo and favicon. */
export function BrandingPage() {
  usePageTitle('Apparence');
  const { user } = useAuth();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Apparence" subtitle="Personnalisez le logo et le favicon" />
      <div className="mt-6">
        {user?.role === 'admin' ? (
          <BrandingManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
