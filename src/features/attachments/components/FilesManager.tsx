import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api, boundedInt, follows } from '@crm/lib/backend';
import {
  ATTACHMENT_MAX_BYTES_CEILING,
  ATTACHMENT_RETENTION_MAX_DAYS,
  ATTACHMENT_RETENTION_MIN_DAYS,
} from '@crm/lib/backend';
import { Button, Card, HelperText, Input, Label, Spinner, toast } from '@crm/design-system';

const MB = 1024 * 1024;

export function FilesManager() {
  const config = useQuery(api.features.config.queries.getAdminConfig);
  const updateConfig = useMutation(api.features.config.mutations.updateConfig);
  const [maxMb, setMaxMb] = useState('');
  const [retention, setRetention] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config) {
      setMaxMb(String(Math.round(config.attachments.maxSizeBytes / MB)));
      setRetention(String(config.attachments.retentionDays));
    }
  }, [config]);

  if (!config) return <Spinner size="sm" />;

  const save = async () => {
    const mb = Number(maxMb);
    if (!follows(boundedInt(1, ATTACHMENT_MAX_BYTES_CEILING / MB), mb)) {
      toast.error(`Indiquez une taille entre 1 et ${ATTACHMENT_MAX_BYTES_CEILING / MB} Mo.`);
      return;
    }
    const days = Number(retention);
    if (!follows(boundedInt(ATTACHMENT_RETENTION_MIN_DAYS, ATTACHMENT_RETENTION_MAX_DAYS), days)) {
      toast.error(
        `Indiquez une durée entre ${ATTACHMENT_RETENTION_MIN_DAYS} et ${ATTACHMENT_RETENTION_MAX_DAYS} jours.`,
      );
      return;
    }
    setBusy(true);
    try {
      await updateConfig({ attachmentsMaxSizeBytes: mb * MB, attachmentsRetentionDays: days });
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
      <div className="space-y-1">
        <Label htmlFor="attachments-retention">
          Durée de conservation dans la corbeille (jours)
        </Label>
        <Input
          id="attachments-retention"
          type="number"
          min={ATTACHMENT_RETENTION_MIN_DAYS}
          max={ATTACHMENT_RETENTION_MAX_DAYS}
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          className="w-40"
          data-testid="attachments-retention"
        />
        <HelperText>
          Un fichier supprimé reste restaurable pendant {retention || '…'} jours, puis est effacé
          définitivement (ligne et contenu) par une tâche quotidienne.
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
