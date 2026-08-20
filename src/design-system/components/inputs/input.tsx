import * as React from 'react';
import { cn } from '../../theme/utils';

interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  invalid?: boolean;
  size?: 'sm' | 'default' | 'lg';
}

function Input({
  className,
  type,
  invalid,
  size = 'default',
  ref,
  ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      type={type}
      data-size={size}
      className={cn(
        'flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-body transition-shadow file:border-0 file:bg-transparent file:text-base file:font-medium file:text-foreground placeholder:text-placeholder focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 md:text-sm data-[size=sm]:h-8 data-[size=default]:h-9.5 data-[size=lg]:h-11',
        invalid && 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/15',
        className
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Input, type InputProps };
