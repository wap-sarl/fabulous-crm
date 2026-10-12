import { useState } from 'react';
import { useAuthMutation } from '@crm/widgets';
import { api } from '@crm/lib/backend';
import {
  Button,
  ConfirmDialog,
  PageHeader,
  SortableList,
  StatusBadge,
  Switch,
  toast,
} from '@crm/design-system';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { CONSENT_CHANNEL_LABEL } from '../../lib/constants';
import { SubscriptionTypeDialog } from '../../features/subscriptions/components/SubscriptionTypeDialog';
import { useSubscriptionTypes } from '../../features/subscriptions/hooks/useSubscriptionTypes';
import { LEGAL_BASIS_LABEL } from '../../features/subscriptions/lib/constants';
import { subscriptionErrorMessage } from '../../features/subscriptions/lib/errors';
import type { SubscriptionTypeRow } from '../../features/subscriptions/types';

/** Settings → Abonnements: the topics a contact subscribes to, in the order the preference centre shows them. */
export function SubscriptionsPage() {
  usePageTitle('Abonnements');
  const types = useSubscriptionTypes();
  const updateType = useAuthMutation(api.features.subscriptions.mutations.updateSubscriptionType);
  const deleteType = useAuthMutation(api.features.subscriptions.mutations.deleteSubscriptionType);
  const reorder = useAuthMutation(api.features.subscriptions.mutations.reorderSubscriptionTypes);
  const ensureDefaults = useAuthMutation(api.features.subscriptions.mutations.ensureDefaults);
  const [editorOpen, setEditorOpen] = useState(false);
  const [toEdit, setToEdit] = useState<SubscriptionTypeRow | null>(null);
  const [toDelete, setToDelete] = useState<SubscriptionTypeRow | null>(null);

  const toggleActive = async (type: SubscriptionTypeRow) => {
    try {
      await updateType({ typeId: type._id, active: !type.active });
    } catch (error) {
      toast.error(subscriptionErrorMessage(error, 'Échec de la mise à jour.'));
    }
  };

  const onReorder = async (ordered: SubscriptionTypeRow[]) => {
    try {
      await reorder({ typeIds: ordered.map((t) => t._id) });
    } catch (error) {
      toast.error(subscriptionErrorMessage(error, 'Échec du réordonnancement.'));
    }
  };

  const createDefaults = async () => {
    try {
      const count = await ensureDefaults({});
      toast.success(`${count} abonnement(s) créé(s).`);
    } catch (error) {
      toast.error(subscriptionErrorMessage(error, 'Échec de la création.'));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <PageHeader
        title="Abonnements"
        subtitle="Les sujets auxquels un contact s’inscrit ; le centre de préférences les propose dans cet ordre et chaque campagne marketing en vise un"
        actions={
          <Button
            onClick={() => {
              setToEdit(null);
              setEditorOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nouvel abonnement
          </Button>
        }
      />
      <div className="mt-6">
        {types.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-soft">
              Aucun abonnement. Sans abonnement, le centre de préférences propose les canaux seuls.
            </p>
            <Button variant="outline" onClick={createDefaults}>
              Créer les abonnements par défaut
            </Button>
          </div>
        ) : (
          <SortableList
            items={types}
            getId={(t) => t._id}
            onReorder={onReorder}
            className="divide-y divide-border rounded-lg border border-border"
            renderItem={(type, _index, handle) => (
              <div className="flex items-center gap-2 px-3 py-3">
                {handle}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{type.name}</span>
                    <StatusBadge tone="gray" withDot={false}>
                      {CONSENT_CHANNEL_LABEL[type.channel]}
                    </StatusBadge>
                    <StatusBadge
                      tone={type.legalBasis === 'consent' ? 'blue' : 'amber'}
                      withDot={false}
                    >
                      {LEGAL_BASIS_LABEL[type.legalBasis]}
                    </StatusBadge>
                  </span>
                  {type.description && (
                    <span className="truncate text-xs text-soft">{type.description}</span>
                  )}
                </span>
                <Switch
                  checked={type.active}
                  onCheckedChange={() => toggleActive(type)}
                  aria-label={`Activer l’abonnement ${type.name}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToEdit(type)}
                  aria-label={`Modifier l’abonnement ${type.name}`}
                >
                  <Pencil className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setToDelete(type)}
                  aria-label={`Supprimer l’abonnement ${type.name}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          />
        )}
      </div>

      {(editorOpen || toEdit) && (
        <SubscriptionTypeDialog
          type={toEdit}
          onClose={() => {
            setEditorOpen(false);
            setToEdit(null);
          }}
        />
      )}
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Supprimer « ${toDelete?.name ?? ''} » ?`}
        description="Les choix et l’historique de consentement qui le citent sont conservés ; préférez le désactiver pour le retirer du centre de préférences."
        confirmLabel="Supprimer"
        destructive
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await deleteType({ typeId: toDelete._id });
            toast.success('Abonnement supprimé.');
          } catch (error) {
            toast.error(subscriptionErrorMessage(error, 'Échec de la suppression.'));
          } finally {
            setToDelete(null);
          }
        }}
      />
    </div>
  );
}
