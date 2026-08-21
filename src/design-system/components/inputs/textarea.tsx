import type * as React from 'react';
import { cn } from '../../theme/utils';

interface TextareaProps extends React.ComponentProps<'textarea'> {
  invalid?: boolean;
}

function Textarea({
  className,
  invalid,
  ref,
  ...props
}: TextareaProps & { ref?: React.Ref<HTMLTextAreaElement> }) {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-base placeholder:text-placeholder focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        invalid &&
          'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/15',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Textarea, type TextareaProps };
