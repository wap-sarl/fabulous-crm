import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HelperText,
  Label,
  MultiSelect,
  Textarea,
  toast,
} from '@crm/design-system';
import { stageRequiresTag } from '@crm/lib/backend';
import type { DealRow, PipelineStage } from '@crm/lib/backend';
import { useDealActions } from '../hooks/useDealActions';
import { dealErrorMessage } from '../lib/errors';

export interface StageEntry {
  tags: string[];
  comment: string;
}

/** Asked when a deal enters a stage that has tags: which tags apply, and a comment. */
export function StageMoveDialog({
  stage,
  dealTitle,
  onConfirm,
  onClose,
}: {
  stage: PipelineStage;
  dealTitle: string;
  onConfirm: (entry: StageEntry) => Promise<void>;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const items = (stage.tags ?? []).map((t) => ({ value: t.key, label: t.label }));
  const required = stageRequiresTag(stage);
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent data-testid="stage-move-dialog">
        <DialogHeader>
          <DialogTitle>
            Passer « {dealTitle} » en « {stage.label} »
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Étiquettes{required ? ' *' : ''}</Label>
          <MultiSelect
            items={items}
            value={tags}
            onValueChange={setTags}
            placeholder="Aucune étiquette"
            modal
            className="w-full"
          />
          <HelperText>
            {required
              ? 'Au moins une étiquette est requise pour entrer dans ce stade.'
              : 'Facultatif : qualifie l’entrée dans ce stade.'}
            {stage.kind === 'lost' ? ' Les motifs de perte se comptent et se filtrent.' : ''}
          </HelperText>
        </div>
        <div className="space-y-1">
          <Label htmlFor="stage-comment">Commentaire</Label>
          <Textarea
            id="stage-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button
            variant="fill"
            color={stage.kind === 'lost' ? 'destructive' : undefined}
            loading={busy}
            disabled={required && tags.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm({ tags, comment });
              } finally {
                setBusy(false);
              }
            }}
            data-testid="confirm-stage-move"
          >
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Move flow shared by the Kanban and the deal page: tagged stages ask first, the others move at once. */
export function useStageMove(onMoved?: (deal: DealRow, stage: PipelineStage) => void) {
  const { moveDealStage } = useDealActions();
  const [pending, setPending] = useState<{ deal: DealRow; stage: PipelineStage } | null>(null);

  const move = async (deal: DealRow, stage: PipelineStage, entry?: StageEntry) => {
    try {
      await moveDealStage({
        dealId: deal._id,
        stageKey: stage.key,
        tags: entry?.tags,
        comment: entry?.comment || undefined,
      });
      toast.success(`Transaction passée en « ${stage.label} ».`);
      setPending(null);
      onMoved?.(deal, stage);
    } catch (e) {
      toast.error(dealErrorMessage(e, 'Impossible de changer de stade.'));
    }
  };

  const requestMove = (deal: DealRow, stage: PipelineStage) => {
    if (stage.key === deal.stageKey) return;
    if (stage.tags?.length) setPending({ deal, stage });
    else void move(deal, stage);
  };

  const dialog = pending ? (
    <StageMoveDialog
      stage={pending.stage}
      dealTitle={pending.deal.title}
      onConfirm={(entry) => move(pending.deal, pending.stage, entry)}
      onClose={() => setPending(null)}
    />
  ) : null;

  return { requestMove, dialog };
}
