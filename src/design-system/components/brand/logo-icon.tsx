import type * as React from 'react';
import { cn } from '../../theme/utils';

interface LogoIconProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 'light' is for dark backgrounds, 'dark' for light ones. */
  variant?: 'light' | 'dark';
  /** Custom brand mark URL; falls back to the gradient tile when omitted/null. */
  src?: string | null;
}

function LogoIcon({
  className,
  variant = 'dark',
  src,
  ref,
  ...props
}: LogoIconProps & { ref?: React.Ref<HTMLDivElement> }) {
  if (src) {
    return (
      <div
        ref={ref}
        className={cn(
          'flex size-[33px] shrink-0 items-center justify-center overflow-hidden rounded-[10px]',
          className,
        )}
        {...props}
      >
        <img src={src} alt="" className="size-full object-contain" />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        'flex size-[33px] shrink-0 items-center justify-center rounded-[10px] bg-linear-140 from-primary to-primary-strong text-base font-bold text-white shadow-[0_4px_12px_var(--primary-soft)]',
        variant === 'light' && 'shadow-none',
        className,
      )}
      {...props}
    >
      C
    </div>
  );
}

export { LogoIcon };
