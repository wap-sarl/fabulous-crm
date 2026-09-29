import { useState } from 'react';
import { useAuthMutation, useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { ApiScope } from '@crm/lib/backend';
import {
  Badge,
  Button,
  ConfirmDialog,
  PageHeader,
  Spinner,
  StatusBadge,
  toast,
} from '@crm/design-system';
import { Ban, KeyRound, Pencil, Plus } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import type { ApiKeyRow } from '../../features/apiKeys/types';
import { RevealKeyDialog } from '../../features/apiKeys/components/RevealKeyDialog';
import { KeyEditorDialog } from '../../features/apiKeys/components/KeyEditorDialog';
import { dateFormat, dateTimeFormat } from '@crm/lib/format';

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

function keyStatus(row: ApiKeyRow): { tone: 'green' | 'red' | 'gray'; label: string } {
  if (row.revokedAt !== undefined) return { tone: 'red', label: 'Révoquée' };
  if (row.expiresAt !== undefined && row.expiresAt <= Date.now()) {
    return { tone: 'gray', label: 'Expirée' };
  }
  return { tone: 'green', label: 'Active' };
}

function keySubtitle(row: ApiKeyRow): string {
  const parts = [`créée le ${dateFormat.format(row.createdAt)}`];
  if (row.expiresAt !== undefined) parts.push(`expire le ${dateFormat.format(row.expiresAt)}`);
  parts.push(
    row.lastUsedAt !== undefined
      ? `dernière utilisation le ${dateTimeFormat.format(row.lastUsedAt)}`
      : 'jamais utilisée',
  );
  return parts.join(' · ');
}

/** Admin management of the public REST API keys (/api/v1/). */
export function ApiKeysPage() {
  usePageTitle('Clés d’API');
  const keys = useAuthQuery(api.features.api.queries.listApiKeys, {});
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
