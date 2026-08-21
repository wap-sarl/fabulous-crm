import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@crm/design-system';
import type { WorkflowNodeType } from '@crm/lib/backend';
import { STEP_TYPES } from '../lib/constants';

interface StepTypePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: WorkflowNodeType) => void;
}

/** « Quelle étape ajouter ? » — grid of the available step types. */
export function StepTypePicker({ open, onOpenChange, onPick }: StepTypePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter une étape</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {STEP_TYPES.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              type="button"
              data-testid={`step-type-${type}`}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left text-[13px] font-semibold text-ink transition-colors hover:border-primary hover:bg-primary/5"
              onClick={() => onPick(type)}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              {label}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
