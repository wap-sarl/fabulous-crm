import { useState } from 'react';
import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import type { ApiScope } from '@crm/lib/backend';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@crm/design-system';
import type { ApiKeyRow } from '../types';

/** Read/write checkbox pairs of the scope picker; write is absent on read-only resources. */
const SCOPE_GROUPS: { label: string; read: ApiScope; write?: ApiScope }[] = [
  { label: 'Contacts', read: 'contacts:read', write: 'contacts:write' },
  { label: 'Entreprises', read: 'companies:read', write: 'companies:write' },
  { label: 'Transactions', read: 'deals:read', write: 'deals:write' },
  { label: 'Activités', read: 'activities:read', write: 'activities:write' },
  { label: 'Listes', read: 'lists:read' },
  { label: 'Propriétés', read: 'properties:read' },
];

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

/** Create/edit modal: name + scope matrix (+ optional expiry at creation). */
export function KeyEditorDialog({
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
