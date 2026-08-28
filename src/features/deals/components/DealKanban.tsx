import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useAuthPaginatedQuery } from '@crm/widgets';
import { api, isTransitionAllowed } from '@crm/lib/backend';
import type { DealRow, Doc, PipelineStage } from '@crm/lib/backend';
import { Button, InitialsAvatar, Skeleton, cn } from '@crm/design-system';
import { User } from 'lucide-react';
import { formatMoney } from '../../../lib/constants';

const COLUMN_PAGE = 25;
const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export interface StageTotals {
  count: number;
  amount: number;
}

interface DealKanbanProps {
  pipeline: Doc<'pipelines'>;
  totals: Record<string, StageTotals>;
  onOpen: (deal: DealRow) => void;
  onMove: (deal: DealRow, stage: PipelineStage) => Promise<void>;
}

function DealCardBody({ deal, dragging }: { deal: DealRow; dragging?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-3 text-left shadow-card transition-shadow',
        dragging ? 'rotate-1 shadow-card-hover' : 'hover:shadow-card-hover',
      )}
    >
      <div className="truncate text-[13px] font-semibold text-ink">{deal.title}</div>
      <div className="mt-1 font-mono text-[12px] text-soft">
        {formatMoney(deal.amount, deal.currency)}
      </div>
      {deal.leadName && (
        <div className="mt-1.5 flex items-center gap-1.5 truncate text-[12px] text-faint">
          <User className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{deal.leadName}</span>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between">
        {deal.expectedCloseDate ? (
          <span className="text-[11px] text-faint">
            {dateFormat.format(new Date(deal.expectedCloseDate))}
          </span>
        ) : (
          <span />
        )}
        {deal.ownerNames[0] ? <InitialsAvatar name={deal.ownerNames[0]} size={22} /> : null}
      </div>
    </div>
  );
}

function DraggableCard({ deal, onOpen }: { deal: DealRow; onOpen: (deal: DealRow) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal._id,
    data: { deal },
  });
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(deal)}
      className={cn('w-full cursor-grab touch-none text-left', isDragging && 'opacity-40')}
      data-testid="deal-card"
    >
      <DealCardBody deal={deal} />
    </button>
  );
}

function StageColumn({
  pipeline,
  stage,
  totals,
  blocked,
  onOpen,
}: {
  pipeline: Doc<'pipelines'>;
  stage: PipelineStage;
  totals: StageTotals | undefined;
  blocked: boolean;
  onOpen: (deal: DealRow) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.key,
    data: { stage },
    disabled: blocked,
  });
  const { results, status, loadMore } = useAuthPaginatedQuery(
    api.features.deals.queries.listStageDeals,
    { pipelineId: pipeline._id, stageKey: stage.key },
    { initialNumItems: COLUMN_PAGE },
  );
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border bg-[#F7F8FA] transition-all',
        isOver && !blocked && 'border-primary bg-primary/5',
        blocked && 'opacity-40 grayscale',
        stage.kind === 'won' && 'border-t-4 border-t-green-500',
        stage.kind === 'lost' && 'border-t-4 border-t-red-400',
      )}
      title={blocked ? 'Transition non autorisée depuis le stade actuel' : undefined}
      data-testid={`kanban-column-${stage.key}`}
      data-blocked={blocked ? 'true' : undefined}
    >
      <div className="flex items-baseline justify-between gap-2 px-3 pt-3">
        <span className="truncate text-[13px] font-bold text-ink">{stage.label}</span>
        <span className="shrink-0 text-[11.5px] text-faint">
          {totals ? `${totals.count} · ${formatMoney(totals.amount, 'EUR')}` : ''}
        </span>
      </div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-3">
        {status === 'LoadingFirstPage'
          ? [1, 2].map((n) => <Skeleton key={n} className="h-20 w-full" />)
          : results.map((deal) => <DraggableCard key={deal._id} deal={deal} onOpen={onOpen} />)}
        {status === 'CanLoadMore' && (
          <Button variant="ghost" size="sm" onClick={() => loadMore(COLUMN_PAGE)}>
            Charger plus
          </Button>
        )}
      </div>
    </div>
  );
}

export function DealKanban({ pipeline, totals, onOpen, onMove }: DealKanbanProps) {
  const [active, setActive] = useState<DealRow | null>(null);
  // A small activation distance keeps a plain click opening the deal.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActive((event.active.data.current as { deal: DealRow } | undefined)?.deal ?? null);
  };
  const handleDragEnd = async (event: DragEndEvent) => {
    const deal = (event.active.data.current as { deal: DealRow } | undefined)?.deal;
    const stage = (event.over?.data.current as { stage: PipelineStage } | undefined)?.stage;
    setActive(null);
    if (!deal || !stage || stage.key === deal.stageKey) return;
    if (!isTransitionAllowed(pipeline, deal.stageKey, stage.key)) return;
    await onMove(deal, stage);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {pipeline.stages.map((stage) => (
          <StageColumn
            key={stage.key}
            pipeline={pipeline}
            stage={stage}
            totals={totals[stage.key]}
            blocked={
              active !== null &&
              stage.key !== active.stageKey &&
              !isTransitionAllowed(pipeline, active.stageKey, stage.key)
            }
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay>{active ? <DealCardBody deal={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
