import { useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { ApiScope, Id } from '@crm/lib/backend';
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeader,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { Ban, Copy, KeyRound, Pencil, Plus } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';

type ApiKeyRow = {
  _id: Id<'apiKeys'>;
  keyId: string;
  name: string;
  scopes: ApiScope[];
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
  createdAt: number;
};

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const DATETIME_FMT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

/** Read/write checkbox pairs of the scope picker; write is absent on read-only resources. */
const SCOPE_GROUPS: { label: string; read: ApiScope; write?: ApiScope }[] = [
  { label: 'Contacts', read: 'contacts:read', write: 'contacts:write' },
  { label: 'Entreprises', read: 'companies:read', write: 'companies:write' },
  { label: 'Transactions', read: 'deals:read', write: 'deals:write' },
  { label: 'Activités', read: 'activities:read', write: 'activities:write' },
  { label: 'Listes', read: 'lists:read' },
  { label: 'Propriétés', read: 'properties:read' },
];

const SCOPE_LABEL: Record<ApiScope, string> = {
  'contacts:read': 'Contacts · lecture',
  'contacts:write': 'Contacts · écriture',
  'companies:read': 'Entreprises · lecture',
  'companies:write': 'Entreprises · écriture',
  'deals:read': 'Transactions · lecture',
  'deals:write': 'Transactions · écriture',
  'activities:read': 'Activités · lecture',
  'activities:write': 'Activités · écriture',
  'lists:read': 'Listes · lecture',
  'forms:read': 'Formulaires · lecture',
  'properties:read': 'Propriétés · lecture',
};

const SAVE_ERRORS: Record<string, string> = {
  api_key_name_required: 'Le nom est requis.',
  api_key_name_too_long: 'Le nom est trop long (60 caractères max).',
  api_key_scopes_required: 'Sélectionnez au moins une portée.',
  api_key_expiry_in_past: 'La date d’expiration est déjà passée.',
};

function saveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const known = Object.keys(SAVE_ERRORS).find((code) => message.includes(code));
  return known ? SAVE_ERRORS[known] : 'Échec de l’enregistrement de la clé.';
}

/** One-time reveal of a freshly created key — it can never be displayed again. */
function RevealKeyDialog({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const copy = async () => {
    await navigator.clipboard.writeText(apiKey);
    toast.success('Clé copiée.');
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clé d’API créée</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-soft">
          Copiez cette clé maintenant et stockez-la en lieu sûr :{' '}
          <span className="font-medium text-ink">elle ne sera plus jamais affichée.</span>
        </p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{apiKey}</code>
          <Button variant="ghost" size="sm" onClick={copy} aria-label="Copier la clé">
            <Copy className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Create/edit modal: name + scope matrix (+ optional expiry at creation). */
function KeyEditorDialog({
  current,
  onCreated,
  onClose,
}: {
  current: ApiKeyRow | null;
  onCreated: (key: string) => void;
  onClose: () => void;
}) {
  const createApiKey = useAuthMutation(api.features.api.mutations.createApiKey);
  const updateApiKey = useAuthMutation(api.features.api.mutations.updateApiKey);
  const [name, setName] = useState(current?.name ?? '');
  const [scopes, setScopes] = useState<ApiScope[]>(current?.scopes ?? []);
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (scope: ApiScope, checked: boolean) =>
    setScopes((prev) => (checked ? [...prev, scope] : prev.filter((s) => s !== scope)));

  const save = async () => {
    setBusy(true);
    try {
      if (current) {
        await updateApiKey({ id: current._id, name: name.trim(), scopes });
        toast.success('Clé mise à jour.');
      } else {
        const { key } = await createApiKey({
          name: name.trim(),
          scopes,
          expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).getTime() : undefined,
        });
        onCreated(key);
      }
      onClose();
    } catch (error) {
      toast.error(saveErrorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {current ? `Modifier « ${current.name} »` : 'Nouvelle clé d’API'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nom</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex. Zapier production"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Portées</Label>
            <p className="text-xs text-soft">
              L’écriture inclut la lecture de la même ressource. Une clé voit et modifie toutes les
              fiches de l’organisation, sans le périmètre des rôles et des équipes.
            </p>
            <div className="divide-y divide-border rounded-lg border border-border">
              {SCOPE_GROUPS.map((group) => (
                <div key={group.read} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm">{group.label}</span>
                  <span className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-soft">
                      <Checkbox
                        checked={scopes.includes(group.read)}
                        onCheckedChange={(c) => toggle(group.read, c === true)}
                      />
                      Lecture
                    </label>
                    {group.write && (
                      <label className="flex items-center gap-1.5 text-xs text-soft">
                        <Checkbox
                          checked={scopes.includes(group.write)}
                          onCheckedChange={(c) => group.write && toggle(group.write, c === true)}
                        />
                        Écriture
                      </label>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {!current && (
            <div className="space-y-1.5">
              <Label>Expiration (optionnelle)</Label>
              <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!name.trim() || scopes.length === 0} onClick={save}>
            {current ? 'Enregistrer' : 'Créer la clé'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function keyStatus(row: ApiKeyRow): { tone: 'green' | 'red' | 'gray'; label: string } {
  if (row.revokedAt !== undefined) return { tone: 'red', label: 'Révoquée' };
  if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) {
    return { tone: 'gray', label: 'Expirée' };
  }
  return { tone: 'green', label: 'Active' };
}

function keySubtitle(row: ApiKeyRow): string {
  const parts = [`créée le ${DATE_FMT.format(row.createdAt)}`];
  if (row.expiresAt !== undefined) parts.push(`expire le ${DATE_FMT.format(row.expiresAt)}`);
  parts.push(
    row.lastUsedAt !== undefined
      ? `dernière utilisation le ${DATETIME_FMT.format(row.lastUsedAt)}`
      : 'jamais utilisée',
  );
  return parts.join(' · ');
}

/** Admin management of the public REST API keys (/api/v1/). */
export function ApiKeysPage() {
  usePageTitle('Clés d’API');
  const keys = useAuthQuery(api.features.api.queries.listApiKeys, {}) as ApiKeyRow[] | undefined;
  const revokeApiKey = useAuthMutation(api.features.api.mutations.revokeApiKey);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toEdit, setToEdit] = useState<ApiKeyRow | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKeyRow | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);

  const revoke = async () => {
    if (!toRevoke) return;
    try {
      await revokeApiKey({ id: toRevoke._id });
      toast.success('Clé révoquée.');
    } catch {
      toast.error('Échec de la révocation.');
    }
    setToRevoke(null);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Clés d’API"
        subtitle="Accès de systèmes tiers à l’API REST publique (/api/v1/)"
        actions={
          <Button onClick={() => setEditorOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Nouvelle clé
          </Button>
        }
      />
      <div className="mt-6">
        {keys === undefined ? (
          <Spinner size="sm" />
        ) : keys.length === 0 ? (
          <p className="text-sm text-soft">
            Aucune clé pour le moment. Créez-en une pour connecter un système tiers (Zapier,
            scripts…).
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {keys.map((row) => {
              const status = keyStatus(row);
              const revoked = row.revokedAt !== undefined;
              return (
                <li key={row._id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <KeyRound className="mt-0.5 size-4 shrink-0 text-soft" aria-hidden="true" />
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{row.name}</span>
                        <code className="font-mono text-xs text-soft">wap_{row.keyId}_…</code>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </div>
                      <p className="text-xs text-soft">{keySubtitle(row)}</p>
                      <div className="flex flex-wrap gap-1">
                        {row.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary">
                            {SCOPE_LABEL[scope]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  {!revoked && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setToEdit(row)}
                        aria-label={`Modifier la clé ${row.name}`}
                        title="Modifier"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setToRevoke(row)}
                        aria-label={`Révoquer la clé ${row.name}`}
                        title="Révoquer"
                      >
                        <Ban className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(editorOpen || toEdit) && (
        <KeyEditorDialog
          current={toEdit}
          onCreated={setRevealed}
          onClose={() => {
            setEditorOpen(false);
            setToEdit(null);
          }}
        />
      )}
      {revealed && <RevealKeyDialog apiKey={revealed} onClose={() => setRevealed(null)} />}
      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title={`Révoquer la clé « ${toRevoke?.name ?? ''} » ?`}
        description="Les appels utilisant cette clé seront refusés immédiatement. Cette action est définitive."
        confirmLabel="Révoquer"
        destructive
        onConfirm={revoke}
      />
    </div>
  );
}
