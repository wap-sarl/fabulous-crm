import type * as React from 'react';
import { cn } from '../../theme/utils';

interface HelperTextProps extends React.ComponentProps<'p'> {
  variant?: 'default' | 'error';
}

function HelperText({ variant = 'default', className, ...props }: HelperTextProps) {
  return (
    <p
      className={cn(
        'text-xs font-normal',
        variant === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
      role={variant === 'error' ? 'alert' : undefined}
      {...props}
    />
  );
}

export { HelperText, type HelperTextProps };
