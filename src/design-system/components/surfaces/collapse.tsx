import * as React from 'react';
import { cn } from '../../theme/utils';

interface CollapseProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  durationMs?: number;
  children: React.ReactNode;
}

function Collapse({
  open,
  durationMs = 300,
  className,
  children,
  style,
  ref,
  ...props
}: CollapseProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'grid ease-out motion-safe:transition-[grid-template-rows]',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className
      )}
      style={{ transitionDuration: `${durationMs}ms`, ...style }}
      {...props}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

export { Collapse, type CollapseProps };
