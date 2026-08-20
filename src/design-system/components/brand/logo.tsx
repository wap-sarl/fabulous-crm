import * as React from 'react';
import { cn } from '../../theme/utils';
import { LogoIcon } from './logo-icon';

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Logo variant: 'light' for dark backgrounds, 'dark' for light backgrounds
   * @default 'dark'
   */
  variant?: 'light' | 'dark';
  /** Custom brand mark URL; falls back to the gradient tile when omitted/null. */
  src?: string | null;
  /** Wordmark text; defaults to "CRM". */
  label?: string;
}

/**
 * Full logo — brand tile plus wordmark and mono caption.
 */
function Logo({
  className,
  variant = 'dark',
  src,
  label = 'CRM',
  ref,
  ...props
}: LogoProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className={cn('flex items-center gap-[11px]', className)} {...props}>
      <LogoIcon variant={variant} src={src} />
      <div className="leading-tight">
        <div
          className={cn('text-[15px] font-bold', variant === 'light' ? 'text-white' : 'text-ink')}
        >
          {label}
        </div>
        <div
          className={cn(
            'font-mono text-[10px]',
            variant === 'light' ? 'text-white/60' : 'text-placeholder'
          )}
        >
          espace de travail
        </div>
      </div>
    </div>
  );
}

export { Logo };
