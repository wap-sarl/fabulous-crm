import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../theme/utils';

const labelVariants = cva(
  'text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

interface LabelProps
  extends
    React.ComponentPropsWithRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {
  /** Append a green `*` after the label text. */
  required?: boolean;
}

function Label({ className, children, required, ref, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props}>
      {children}
      {required && <span className="text-primary"> *</span>}
    </LabelPrimitive.Root>
  );
}

export { Label };
