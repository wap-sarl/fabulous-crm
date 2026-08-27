import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import { ATTACHMENT_MAX_BYTES_CEILING } from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import {
  Button,
  Card,
  HelperText,
  Input,
  Label,
  PageHeader,
  Spinner,
  toast,
} from '@crm/design-system';
import { usePageTitle } from '../../layouts/DashboardShell';

const MB = 1024 * 1024;

function FilesManager() {
  const config = useQuery(api.features.config.queries.getAdminConfig);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const [maxMb, setMaxMb] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config) setMaxMb(String(Math.round(config.attachments.maxSizeBytes / MB)));
  }, [config]);

  if (!config) return <Spinner size="sm" />;

  const save = async () => {
    const mb = Number(maxMb);
    if (!Number.isInteger(mb) || mb < 1 || mb > ATTACHMENT_MAX_BYTES_CEILING / MB) {
      toast.error(`Indiquez une taille entre 1 et ${ATTACHMENT_MAX_BYTES_CEILING / MB} Mo.`);
      return;
    }
    setBusy(true);
    try {
      await updateConfig({ attachmentsMaxSizeBytes: mb * MB });
      toast.success('Paramètres enregistrés.');
    } catch {
      toast.error("L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-6">
      <div className="space-y-1">
        <Label htmlFor="attachments-max">Taille maximale d’un fichier (Mo)</Label>
        <Input
          id="attachments-max"
          type="number"
          min={1}
          max={ATTACHMENT_MAX_BYTES_CEILING / MB}
          value={maxMb}
          onChange={(e) => setMaxMb(e.target.value)}
          className="w-40"
        />
        <HelperText>
          Appliquée à chaque fichier joint aux leads, entreprises et transactions, côté serveur au
          moment de l’envoi.
        </HelperText>
      </div>
      <p className="text-xs text-faint">
        Les fichiers sont stockés dans Convex Storage sous une clé{' '}
        <span className="font-mono">type/identifiant/dossier/nom</span>, prête pour un stockage
        objet (S3) avec la même arborescence.
      </p>
      <div className="flex justify-end">
        <Button onClick={save} loading={busy}>
          Enregistrer
        </Button>
      </div>
    </Card>
  );
}

/** Admin-only settings: attachment limits. */
export function FilesPage() {
  usePageTitle('Fichiers');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader title="Fichiers" subtitle="Pièces jointes des fiches" />
      <div className="mt-6">
        {user?.access.settings ? (
          <FilesManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
