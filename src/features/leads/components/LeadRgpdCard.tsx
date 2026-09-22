import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import { describeError } from '@crm/lib/errors';
import { useAuth, useAuthAction, useAuthMutation, useAuthQuery } from '@crm/widgets';
import { Button, Card, ConfirmDialog, Label, Switch, toast } from '@crm/design-system';
import { Download, ShieldAlert } from 'lucide-react';

const REQUEST_LABEL: Record<string, string> = {
  access: 'Droit d’accès : export remis',
  erasure: 'Droit à l’effacement',
  objection: 'Opposition au profilage',
  objection_lifted: 'Opposition levée',
};
const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

/** The person's rights on their data, for the settings holders: access (an export), objection to profiling, erasure. */
export function LeadRgpdCard({
  leadId,
  fullName,
  excludeFromProfiling,
}: {
  leadId: Id<'leads'>;
  fullName: string;
  excludeFromProfiling: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const allowed = user?.access.settings ?? false;
  const requests = useAuthQuery(
    api.features.rgpd.queries.listRequests,
    allowed ? { leadId } : 'skip',
  );
  const exportContact = useAuthAction(api.features.rgpd.actions.exportContactData);
  const setExclusion = useAuthMutation(api.features.rgpd.mutations.setProfilingExclusion);
  const erase = useAuthMutation(api.features.rgpd.mutations.eraseContact);
  const [busy, setBusy] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  if (!allowed) return null;

  const download = async () => {
    setBusy(true);
    try {
      const { archive } = await exportContact({ leadId });
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `contact-${leadId}.json`;
      link.click();
      URL.revokeObjectURL(url);
      if (archive.cut.length > 0) {
        toast.warning(`Export tronqué pour : ${archive.cut.join(', ')}.`);
      } else {
        toast.success('Export téléchargé.');
      }
    } catch (error) {
      toast.error(describeError(error, 'L’export a échoué.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="mb-2 text-[15px] font-bold text-ink">Droits de la personne (RGPD)</h2>
      <p className="mb-3 text-xs text-soft">
        À traiter dans le mois qui suit la demande. Chaque action est consignée.
      </p>
      <div className="space-y-3">
        <Button variant="ghost" className="w-full" onClick={download} disabled={busy}>
          <Download className="h-4 w-4" />
          Exporter ses données (JSON)
        </Button>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="rgpd-objection" className="text-sm">
            Opposition au profilage
          </Label>
          <Switch
            id="rgpd-objection"
            checked={excludeFromProfiling}
            onCheckedChange={async (exclude) => {
              try {
                await setExclusion({ leadId, exclude });
                toast.success(exclude ? 'Profilage arrêté.' : 'Profilage repris.');
              } catch (error) {
                toast.error(describeError(error, 'La modification a échoué.'));
              }
            }}
          />
        </div>
        <p className="text-xs text-soft">
          Sans profilage : aucun score, aucun compteur d’ouverture ou de clic, la fiche reste.
        </p>
        <Button
          variant="ghost"
          className="w-full text-destructive"
          onClick={() => setConfirmErase(true)}
        >
          <ShieldAlert className="h-4 w-4" />
          Effacer définitivement
        </Button>
      </div>
      {requests && requests.length > 0 ? (
        <ul className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-soft">
          {requests.map((r) => (
            <li key={r._id}>
              {DATE_FMT.format(r.requestedAt)} · {REQUEST_LABEL[r.type] ?? r.type}
              {r.outcome === 'in_progress' ? ' (en cours)' : ''}
              {r.requestedBy ? ` · ${r.requestedBy}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={confirmErase}
        onOpenChange={(o) => !o && setConfirmErase(false)}
        title={`Effacer définitivement ${fullName} ?`}
        description="La fiche, ses notes, ses envois, ses enrôlements, son historique, ses fichiers et son journal sont supprimés sans retour possible. Seule une trace anonyme (identifiant et date) est conservée. Les transactions et activités liées restent, sans lien."
        confirmLabel="Effacer"
        destructive
        onConfirm={async () => {
          try {
            await erase({ leadId, confirm: true });
            toast.success('Effacement lancé.');
            navigate('/leads');
          } catch (error) {
            toast.error(describeError(error, 'L’effacement a échoué.'));
          }
          setConfirmErase(false);
        }}
      />
    </Card>
  );
}
