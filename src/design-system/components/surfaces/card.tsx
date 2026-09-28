import type * as React from 'react';
import { cn } from '../../theme/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  clickable?: boolean;
}

function Card({
  className,
  clickable,
  ref,
  ...props
}: CardProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-card',
        clickable && 'cursor-pointer transition-all hover:border-[#DADDE4] hover:shadow-card-hover',
        className,
      )}
      {...props}
    />
  );
}

export { Card };
