import type * as React from 'react';
import { cn } from '../../theme/utils';

export interface LogoIconProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Icon variant: 'light' for dark backgrounds, 'dark' for light backgrounds
   * @default 'dark'
   */
  variant?: 'light' | 'dark';
  /**
   * Custom brand mark URL. When provided, the uploaded image is rendered in
   * place of the gradient tile; falls back to the tile when omitted/null.
   */
  src?: string | null;
}

/**
 * Brand mark — rounded gradient tile with the app initial, or a custom uploaded
 * image when `src` is provided.
 */
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
