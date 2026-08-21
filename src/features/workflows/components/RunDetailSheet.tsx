import { api } from '@crm/lib/backend';
import type { Id, WorkflowNode } from '@crm/lib/backend';
import { useAuthQuery } from '@crm/widgets';
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Spinner,
  StatusBadge,
  cn,
} from '@crm/design-system';
import {
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE,
  STEP_OUTCOME_LABEL,
  STEP_OUTCOME_TONE,
  STEP_TYPE_META,
  TRIGGER_TYPE_LABEL,
} from '../lib/constants';

const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const DOT_CLASS: Record<string, string> = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  gray: 'bg-gray-400',
  violet: 'bg-violet-500',
};

interface RunDetailSheetProps {
  runId: Id<'workflowRuns'> | null;
  onClose: () => void;
  onCancelRun?: (runId: Id<'workflowRuns'>) => void;
}

/** Per-run step log: which steps ran, when, and how each one ended. */
export function RunDetailSheet({ runId, onClose, onCancelRun }: RunDetailSheetProps) {
  const run = useAuthQuery(api.features.workflows.queries.getRun, runId ? { runId } : 'skip');
  const nodeById = new Map<string, WorkflowNode>(
    (run?.workflow?.nodes ?? []).map((n) => [n.id, n]),
  );

  return (
    <Sheet open={runId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {run?.lead ? `${run.lead.firstName} ${run.lead.lastName}` : 'Parcours'}
          </SheetTitle>
          <SheetDescription>
            {run
              ? `Inscrit le ${dateTimeFormat.format(new Date(run.enrolledAt))} — ${
                  TRIGGER_TYPE_LABEL[run.triggerType as keyof typeof TRIGGER_TYPE_LABEL] ??
                  run.triggerType
                }`
              : ''}
          </SheetDescription>
        </SheetHeader>

        {run === undefined ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : run === null ? (
          <div className="py-10 text-center text-faint">Parcours introuvable.</div>
        ) : (
          <div className="flex flex-col gap-4 py-4">
            <div className="flex items-center gap-2">
              <StatusBadge tone={RUN_STATUS_TONE[run.status]}>
                {RUN_STATUS_LABEL[run.status]}
              </StatusBadge>
              {run.error ? <span className="text-[12px] text-red-600">{run.error}</span> : null}
              {run.status === 'active' && onCancelRun ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => onCancelRun(run._id)}
                >
                  Annuler le parcours
                </Button>
              ) : null}
            </div>

            {run.steps.length === 0 ? (
              <div className="rounded-lg border bg-card py-8 text-center text-[13px] text-faint">
                Aucune étape exécutée pour le moment.
              </div>
            ) : (
              <ol className="relative flex flex-col gap-0 border-l border-[#E4E6EB] pl-5">
                {run.steps.map((step) => {
                  const node = nodeById.get(step.nodeId);
                  const meta = STEP_TYPE_META.get(
                    (node?.type ?? step.nodeType) as Parameters<typeof STEP_TYPE_META.get>[0],
                  );
                  const Icon = meta?.icon;
                  return (
                    <li key={step._id} className="relative pb-5 last:pb-0">
                      <span
                        className={cn(
                          'absolute -left-[26.5px] top-1 size-3 rounded-full ring-4 ring-canvas',
                          DOT_CLASS[STEP_OUTCOME_TONE[step.status]] ?? 'bg-gray-400',
                        )}
                      />
                      <div className="flex items-center gap-2">
                        {Icon ? <Icon className="size-4 text-faint" /> : null}
                        <span className="text-[13.5px] font-semibold text-ink">
                          {meta?.label ?? step.nodeType}
                        </span>
                        {step.branchResult !== undefined ? (
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10.5px] font-bold uppercase',
                              step.branchResult
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-600',
                            )}
                          >
                            {step.branchResult ? 'Oui' : 'Non'}
                          </span>
                        ) : null}
                        <StatusBadge tone={STEP_OUTCOME_TONE[step.status]}>
                          {STEP_OUTCOME_LABEL[step.status]}
                        </StatusBadge>
                      </div>
                      <div className="mt-0.5 text-[12px] text-faint">
                        {dateTimeFormat.format(new Date(step.startedAt))}
                        {step.detail ? ` — ${step.detail}` : ''}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
