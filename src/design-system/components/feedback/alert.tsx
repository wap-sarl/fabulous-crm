import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../theme/utils';

const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-card text-foreground',
        destructive:
          'border-destructive/50 text-destructive [&>svg]:text-destructive',
        success: 'border-primary/50 text-primary bg-primary/10 [&>svg]:text-primary',
        warning: 'border-warning/50 text-warning bg-warning/10 [&>svg]:text-warning',
        info: 'border-secondary/50 text-secondary bg-secondary/10 [&>svg]:text-secondary',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Alert({
  className,
  variant,
  ref,
  ...props
}: React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof alertVariants> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
  );
}

function AlertTitle({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
  return (
    <h5
      ref={ref}
      className={cn('mb-1 font-medium leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ref,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement> & { ref?: React.Ref<HTMLParagraphElement> }) {
  return <div ref={ref} className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
