import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { Id } from '@crm/lib/backend';
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MultiSelect,
  Spinner,
  toast,
} from '@crm/design-system';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useEmployees } from '../../../lib/hooks/useEmployees';

type TeamRow = NonNullable<
  ReturnType<typeof useQuery<typeof api.features.teams.queries.listTeams>>
>[number];

const TEAM_ERRORS: Record<string, string> = {
  team_name_required: 'Le nom de l’équipe est requis.',
  team_name_too_long: 'Nom trop long.',
  invalid_member: 'Un des membres n’est pas un collaborateur actif.',
  team_not_found: 'Cette équipe n’existe plus.',
};

function teamErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  const key = Object.keys(TEAM_ERRORS).find((k) => message.includes(k));
  return key ? TEAM_ERRORS[key] : 'Une erreur est survenue.';
}

export function TeamsSection() {
  const teams = useQuery(api.features.teams.queries.listTeams, {});
  const deleteTeam = useMutation(api.features.teams.mutations.deleteTeam);
  const [editing, setEditing] = useState<TeamRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TeamRow | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteTeam({ teamId: deleting._id });
      toast.success('Équipe supprimée.');
    } catch (e) {
      toast.error(teamErrorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="space-y-3" data-testid="teams-section">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
          <Users className="size-4" aria-hidden="true" />
          Équipes
        </h2>
        <Button size="sm" onClick={() => setEditing('new')} data-testid="new-team">
          <Plus className="size-4" />
          Nouvelle équipe
        </Button>
      </div>
      <p className="text-xs text-faint">
        Un manager ne voit que les fiches (leads, entreprises, transactions) dont un propriétaire
        fait partie de ses équipes, plus les fiches sans propriétaire. Les administrateurs et les
        membres voient tout.
      </p>
      {teams === undefined ? (
        <Spinner size="sm" />
      ) : teams.length === 0 ? (
        <Card className="p-6 text-center text-sm text-faint">Aucune équipe.</Card>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {teams.map((team) => (
            <li key={team._id} className="flex items-center gap-3 px-4 py-3" data-testid="team-row">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{team.name}</p>
                <p className="truncate text-xs text-soft">
                  {team.members.length > 0
                    ? team.members.map((m) => m.name).join(', ')
                    : 'Aucun membre'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing(team)}
                aria-label="Modifier"
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleting(team)}
                aria-label="Supprimer"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <TeamDialog
          team={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer l’équipe « ${deleting?.name ?? ''} » ?`}
        description="Les managers de cette équipe perdent immédiatement ce périmètre."
        confirmLabel="Supprimer"
        destructive
        onConfirm={remove}
      />
    </section>
  );
}

function TeamDialog({ team, onClose }: { team?: TeamRow; onClose: () => void }) {
  const createTeam = useMutation(api.features.teams.mutations.createTeam);
  const updateTeam = useMutation(api.features.teams.mutations.updateTeam);
  const { employees } = useEmployees();
  const [name, setName] = useState(team?.name ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(team?.memberIds ?? []);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const ids = memberIds as Id<'users'>[];
      if (team) {
        await updateTeam({ teamId: team._id, name, memberIds: ids });
        toast.success('Équipe mise à jour.');
      } else {
        await createTeam({ name, memberIds: ids });
        toast.success('Équipe créée.');
      }
      onClose();
    } catch (e) {
      toast.error(teamErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{team ? 'Modifier l’équipe' : 'Nouvelle équipe'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="team-name">Nom *</Label>
            <Input
              id="team-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Commerciaux Sud"
              data-testid="team-name"
            />
          </div>
          <div className="space-y-1">
            <Label>Membres</Label>
            <MultiSelect
              items={employees.map((e) => ({
                value: e._id,
                label: `${e.firstName} ${e.lastName}`,
              }))}
              value={memberIds}
              onValueChange={setMemberIds}
              placeholder="Choisir des collaborateurs…"
              modal
              className="w-full"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} data-testid="submit-team">
            {team ? 'Enregistrer' : 'Créer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
