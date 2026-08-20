import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../theme/utils';
import { usePortalContainer } from '../portal-container';
import { useIsMobile } from '../../hooks/useIsMobile';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn('fixed inset-0 z-50 bg-black/80', className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Content>) {
  const container = usePortalContainer();
  const isMobile = useIsMobile();
  return (
    <DialogPortal container={container}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          isMobile
            ? 'fixed inset-x-0 bottom-0 z-50 grid grid-cols-1 w-full gap-4 border-t bg-card p-6 shadow-lg rounded-t-xl max-h-[85vh] overflow-y-auto overflow-x-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom data-[state=open]:duration-300 data-[state=closed]:duration-200'
            : 'fixed left-[50%] top-[50%] z-50 grid grid-cols-1 w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-card p-6 shadow-lg sm:rounded-xl max-h-[85vh] overflow-y-auto overflow-x-hidden',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 cursor-pointer rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

function DialogTitle({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ref,
  ...props
}: React.ComponentPropsWithRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
