import { Dialog, DialogContent } from '@crm/design-system';
import type { DealFormDialogProps } from '../types';
import { DealFormBody } from './DealFormBody';

export function DealFormDialog({
  open,
  onOpenChange,
  deal,
  defaults,
  onCreated,
}: DealFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <DealFormBody
            key={deal?._id ?? 'new'}
            deal={deal}
            defaults={defaults}
            onOpenChange={onOpenChange}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
