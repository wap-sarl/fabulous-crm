import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@crm/lib/backend';
import type { Id, PropertyEntityType } from '@crm/lib/backend';
import { Button, Card, ConfirmDialog, SortableList, Spinner, toast } from '@crm/design-system';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PROPERTY_ENTITIES, PROPERTY_TYPE_LABEL } from '../lib/customProperties';
import type { PropertyDefinitionRow } from '../types';
import { DefinitionDialog } from './DefinitionDialog';

export function PropertiesManager({ entityType }: { entityType: PropertyEntityType }) {
  const definitions = useQuery(api.features.properties.queries.listDefinitions, { entityType });
  const entity = PROPERTY_ENTITIES.find((e) => e.value === entityType);
  const deleteDefinition = useMutation(api.features.properties.mutations.deleteDefinition);
  const reorderDefinitions = useMutation(api.features.properties.mutations.reorderDefinitions);
  const [localOrder, setLocalOrder] = useState<{
    base: PropertyDefinitionRow[] | undefined;
    order: PropertyDefinitionRow[];
  } | null>(null);
  const ordered =
    (localOrder?.base === definitions ? localOrder?.order : undefined) ?? definitions ?? [];

  const handleReorder = async (next: PropertyDefinitionRow[]) => {
    setLocalOrder({ base: definitions, order: next });
    try {
      await reorderDefinitions({
        definitionIds: next.map((d) => d._id as Id<'propertyDefinitions'>),
      });
    } catch {
      setLocalOrder(null);
      toast.error('Échec du réordonnancement.');
    }
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PropertyDefinitionRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<PropertyDefinitionRow | null>(null);

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (def: PropertyDefinitionRow) => {
    setEditing(def);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteDefinition({ definitionId: deleting._id as Id<'propertyDefinitions'> });
      toast.success('Propriété supprimée.');
    } catch {
      toast.error('Échec de la suppression.');
    } finally {
      setDeleting(null);
    }
  };

  if (definitions === undefined) return <Spinner size="sm" />;

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-soft">
          Définissez des champs personnalisés attachés à {entity?.singular ?? 'chaque fiche'}.
        </p>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nouvelle propriété
        </Button>
      </div>

      {definitions.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">Aucune propriété personnalisée.</p>
      ) : (
        <SortableList
          items={ordered}
          getId={(def) => def._id}
          onReorder={handleReorder}
          className="gap-0 divide-y divide-border rounded-lg border border-border"
          itemClassName="flex items-center gap-3 px-2 py-3"
          renderItem={(def, _index, handle) => (
            <>
              {handle}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{def.label}</p>
                <p className="text-xs text-faint">
                  {PROPERTY_TYPE_LABEL[def.type]}
                  {def.type === 'select' && def.options ? ` · ${def.options.length} option(s)` : ''}
                  {def.showInTable ? ' · colonne' : ''}
                  {def.computed ? ' · calculée' : ''}
                </p>
              </div>
              <button
                type="button"
                aria-label="Modifier"
                onClick={() => openEdit(def)}
                className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-[#EEF0F3] hover:text-body"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Supprimer"
                onClick={() => setDeleting(def)}
                className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-destructive-soft hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        />
      )}

      <DefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityType={entityType}
        definition={editing}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer la propriété « ${deleting?.label ?? ''} » ?`}
        description="Les valeurs déjà saisies restent stockées mais ne sont plus affichées."
        confirmLabel="Supprimer"
        destructive
        onConfirm={handleDelete}
      />
    </Card>
  );
}
