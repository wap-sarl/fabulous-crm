import { useState } from 'react';
import type { Id } from '@crm/lib/backend';
import { DEFAULT_PIPELINE_STAGES } from '@crm/lib/backend';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Input,
  Label,
  PageHeader,
  Spinner,
  toast,
} from '@crm/design-system';
import { Plus } from 'lucide-react';
import { usePageTitle } from '../../layouts/DashboardShell';
import { useDealActions } from '../../features/deals/hooks/useDealActions';
import { usePipelines } from '../../features/deals/hooks/usePipelines';
import { dealErrorMessage } from '../../features/deals/lib/errors';
import { PipelineCard } from '../../features/deals/components/PipelineCard';

export function PipelinesPage() {
  usePageTitle('Pipelines');
  const { pipelines, isLoading } = usePipelines();
  const { createPipeline } = useDealActions();
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const create = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Le nom du pipeline est requis.');
      return;
    }
    setCreating(true);
    try {
      await createPipeline({ name, stages: [...DEFAULT_PIPELINE_STAGES] });
      toast.success('Pipeline créé.');
      setCreateOpen(false);
      setNewName('');
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Échec de la création.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title="Pipelines"
        subtitle="Stades des transactions, transitions autorisées entre stades (linéaires par défaut) et pipeline par défaut"
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="new-pipeline">
            <Plus className="size-4" />
            Nouveau pipeline
          </Button>
        }
      />
      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nouveau pipeline</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-pipeline-name">Nom</Label>
            <Input
              id="new-pipeline-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="Pipeline partenaires"
              autoFocus
            />
            <HelperText>
              Le pipeline démarre avec les stades standard et des transitions linéaires, modifiables
              ensuite.
            </HelperText>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Annuler
            </Button>
            <Button onClick={create} loading={creating} data-testid="create-pipeline">
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="mt-6 flex flex-col gap-5">
        {isLoading ? (
          <Spinner size="sm" />
        ) : (
          pipelines.map((p) => <PipelineCard key={p._id as Id<'pipelines'>} pipeline={p} />)
        )}
      </div>
    </div>
  );
}
