import type * as React from 'react';
import { cn } from '../../theme/utils';
import { LogoIcon } from './logo-icon';

export interface AppLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Whether to show drop shadow
   * @default true
   */
  withShadow?: boolean;
  /** Custom brand mark URL; falls back to the gradient tile when omitted/null. */
  src?: string | null;
}

/**
 * App logo — the brand tile alone (for app icons and loaders).
 */
function AppLogo({
  className,
  withShadow = true,
  src,
  ref,
  ...props
}: AppLogoProps & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <LogoIcon
      ref={ref}
      variant={withShadow ? 'dark' : 'light'}
      src={src}
      className={cn('size-12 rounded-xl text-2xl', className)}
      {...props}
    />
  );
}

export { AppLogo };
