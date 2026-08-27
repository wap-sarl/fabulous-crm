import { useEffect, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { AccessLevel, AccessModule, RoleAccess } from '@crm/lib/backend';
import {
  ACCESS_LEVELS,
  ACCESS_MODULES,
  ADMIN_ROLE_KEY,
  DEFAULT_ROLES,
  MAX_ROLE_LABEL_LENGTH,
  accessWarnings,
} from '@crm/lib/backend';
import { useAuth } from '@crm/widgets';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Switch,
  cn,
  toast,
} from '@crm/design-system';
import { Lock, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useRoles } from '../../lib/hooks/useRoles';
import {
  ACCESS_LEVEL_LABEL,
  ACCESS_MODULE_LABEL,
  accessWarningMessage,
} from '../../features/access/lib/constants';

const ROLE_ERRORS: Record<string, string> = {
  role_label_required: 'Le nom du rôle est requis.',
  role_label_too_long: 'Nom trop long.',
  role_label_invalid: 'Ce nom ne donne pas de clé valide.',
  role_admin_locked: 'Le rôle Administrateur ne peut pas être restreint.',
  role_built_in: 'Un rôle intégré ne peut pas être supprimé.',
  role_in_use: 'Ce rôle est encore utilisé : choisissez un rôle de remplacement.',
  role_lock_out: 'Vous ne pouvez pas retirer « Paramètres » à votre propre rôle.',
  role_not_found: 'Ce rôle n’existe plus.',
};

function roleErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : '';
  const key = Object.keys(ROLE_ERRORS).find((k) => message.includes(k));
  return key ? ROLE_ERRORS[key] : 'Une erreur est survenue.';
}

type RoleRow = ReturnType<typeof useRoles>['roles'][number];

function RolesManager() {
  const { user } = useAuth();
  const { roles, isLoading } = useRoles();
  const ensureDefaults = useMutation(api.features.roles.mutations.ensureDefaults);
  const updateRole = useMutation(api.features.roles.mutations.updateRole);
  const [drafts, setDrafts] = useState<Record<string, RoleAccess>>({});
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);

  // Seed the built-in rows on first visit (idempotent).
  useEffect(() => {
    void ensureDefaults({}).catch(() => {});
  }, [ensureDefaults]);

  const accessOf = (role: RoleRow): RoleAccess => drafts[role.key] ?? role.access;
  const dirtyKeys = roles
    .filter((r) => drafts[r.key] && drafts[r.key] !== r.access)
    .map((r) => r.key);

  const setCell = (
    role: RoleRow,
    module: AccessModule | 'settings',
    value: AccessLevel | boolean,
  ) =>
    setDrafts((prev) => ({
      ...prev,
      [role.key]: { ...accessOf(role), [module]: value } as RoleAccess,
    }));

  const warnings = accessWarnings(
    roles.map((r) => ({ key: r.key, access: accessOf(r) })),
    {
      callerRoleKey: user?.role ?? '',
      rolesWithoutTeamMembers: new Set(
        roles.filter((r) => r.usersWithoutTeam > 0).map((r) => r.key),
      ),
    },
  );
  const labelOf = (key: string) => roles.find((r) => r.key === key)?.label ?? key;

  const save = async () => {
    setSaving(true);
    try {
      for (const key of dirtyKeys) await updateRole({ key, access: drafts[key] });
      setDrafts({});
      toast.success('Accès enregistrés.');
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () =>
    setDrafts((prev) => {
      const next = { ...prev };
      for (const d of DEFAULT_ROLES) next[d.key] = d.access;
      return next;
    });

  if (isLoading) return <Spinner size="sm" />;

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-soft">
            Pour chaque rôle, le niveau d’accès par module. « Mes fiches » et « Mon équipe »
            incluent les fiches sans propriétaire (le pool).
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={resetDefaults}>
              <RotateCcw className="size-4" />
              Valeurs par défaut
            </Button>
            <Button size="sm" onClick={() => setCreating(true)} data-testid="new-role">
              <Plus className="size-4" />
              Nouveau rôle
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm" data-testid="access-matrix">
            <thead className="bg-[#F7F8FA] text-xs text-faint">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Rôle</th>
                {ACCESS_MODULES.map((m) => (
                  <th key={m} className="px-2 py-2 text-left font-medium">
                    {ACCESS_MODULE_LABEL[m]}
                  </th>
                ))}
                <th className="px-2 py-2 text-left font-medium">Paramètres</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {roles.map((role) => {
                const locked = role.key === ADMIN_ROLE_KEY;
                const access = accessOf(role);
                return (
                  <tr key={role.key} data-testid={`role-row-${role.key}`}>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{role.label}</span>
                        {locked && <Lock className="size-3.5 text-faint" aria-label="Verrouillé" />}
                        <Badge variant="secondary">{role.userCount}</Badge>
                      </div>
                      <span className="text-xs text-faint">
                        {role.builtIn ? 'intégré' : 'personnalisé'} · {role.key}
                      </span>
                    </td>
                    {ACCESS_MODULES.map((m) => (
                      <td key={m} className="px-2 py-2 align-middle">
                        <Select
                          value={access[m]}
                          disabled={locked}
                          onValueChange={(v) => setCell(role, m, v as AccessLevel)}
                        >
                          <SelectTrigger className={cn('h-8 w-32', locked && 'opacity-60')}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ACCESS_LEVELS.map((l) => (
                              <SelectItem key={l} value={l}>
                                {ACCESS_LEVEL_LABEL[l]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    ))}
                    <td className="px-2 py-2 align-middle">
                      <Switch
                        checked={access.settings}
                        disabled={locked}
                        onCheckedChange={(c) => setCell(role, 'settings', c === true)}
                        aria-label={`Paramètres pour ${role.label}`}
                      />
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRenaming(role)}
                          aria-label="Renommer"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        {!role.builtIn && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(role)}
                            aria-label="Supprimer"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {warnings.map((w) => (
              <li key={`${w.code}:${w.roleKey}`}>{accessWarningMessage(w, labelOf(w.roleKey))}</li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-end gap-2">
          {dirtyKeys.length > 0 && (
            <Button variant="ghost" onClick={() => setDrafts({})} disabled={saving}>
              Annuler
            </Button>
          )}
          <Button
            onClick={save}
            loading={saving}
            disabled={dirtyKeys.length === 0}
            data-testid="save-access"
          >
            Enregistrer
          </Button>
        </div>
      </Card>

      {creating && <NewRoleDialog roles={roles} onClose={() => setCreating(false)} />}
      {renaming && <RenameRoleDialog role={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <DeleteRoleDialog role={deleting} roles={roles} onClose={() => setDeleting(null)} />
      )}
    </div>
  );
}

function NewRoleDialog({ roles, onClose }: { roles: RoleRow[]; onClose: () => void }) {
  const createRole = useMutation(api.features.roles.mutations.createRole);
  const [label, setLabel] = useState('');
  const [copyFrom, setCopyFrom] = useState('member');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const source = roles.find((r) => r.key === copyFrom) ?? roles[0];
      await createRole({ label, access: { ...source.access, settings: false } });
      toast.success('Rôle créé.');
      onClose();
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouveau rôle</DialogTitle>
          <DialogDescription>
            Les niveaux d’accès sont copiés d’un rôle existant, puis ajustables dans la grille.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="role-label">Nom *</Label>
            <Input
              id="role-label"
              value={label}
              maxLength={MAX_ROLE_LABEL_LENGTH}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Support, Commercial senior…"
              data-testid="role-label"
            />
          </div>
          <div className="space-y-1">
            <Label>Copier les accès de</Label>
            <Select value={copyFrom} onValueChange={setCopyFrom}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <HelperText>« Paramètres » reste désactivé pour un nouveau rôle.</HelperText>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            onClick={submit}
            loading={busy}
            disabled={!label.trim()}
            data-testid="submit-role"
          >
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RenameRoleDialog({ role, onClose }: { role: RoleRow; onClose: () => void }) {
  const updateRole = useMutation(api.features.roles.mutations.updateRole);
  const [label, setLabel] = useState(role.label);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await updateRole({ key: role.key, label });
      toast.success('Rôle renommé.');
      onClose();
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renommer « {role.label} »</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="rename-role">Nom</Label>
          <Input
            id="rename-role"
            value={label}
            maxLength={MAX_ROLE_LABEL_LENGTH}
            onChange={(e) => setLabel(e.target.value)}
          />
          <HelperText>La clé « {role.key} » ne change pas.</HelperText>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={submit} loading={busy} disabled={!label.trim()}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleDialog({
  role,
  roles,
  onClose,
}: {
  role: RoleRow;
  roles: RoleRow[];
  onClose: () => void;
}) {
  const deleteRole = useMutation(api.features.roles.mutations.deleteRole);
  const others = roles.filter((r) => r.key !== role.key);
  const [replacement, setReplacement] = useState('member');
  const [busy, setBusy] = useState(false);
  const inUse = role.userCount > 0;
  const confirm = async () => {
    setBusy(true);
    try {
      await deleteRole({ key: role.key, replacementKey: inUse ? replacement : undefined });
      toast.success('Rôle supprimé.');
      onClose();
    } catch (e) {
      toast.error(roleErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!inUse) {
    return (
      <ConfirmDialog
        open
        onOpenChange={(o) => !o && onClose()}
        title={`Supprimer le rôle « ${role.label} » ?`}
        description="Aucun utilisateur ne le détient."
        confirmLabel="Supprimer"
        destructive
        onConfirm={confirm}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer le rôle « {role.label} » ?</DialogTitle>
          <DialogDescription>
            {role.userCount} utilisateur(s) le détiennent : choisissez le rôle qu’ils recevront.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Rôle de remplacement</Label>
          <Select value={replacement} onValueChange={setReplacement}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button color="destructive" onClick={confirm} loading={busy}>
            Supprimer et réaffecter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Settings: roles and the access matrix. */
export function RolesPage() {
  usePageTitle('Rôles et accès');
  const { user } = useAuth();
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <PageHeader title="Rôles et accès" subtitle="Qui voit quoi, module par module" />
      <div className="mt-6">
        {user?.access.settings ? (
          <RolesManager />
        ) : (
          <p className="text-sm text-soft">Cette page est réservée aux administrateurs.</p>
        )}
      </div>
    </div>
  );
}
