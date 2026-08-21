import type * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../theme/utils';

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned actions (buttons). */
  actions?: React.ReactNode;
  /** Renders the detail variant with a back button when provided. */
  onBack?: () => void;
  /** Slot before the title (avatar, icon…) — detail variant. */
  leading?: React.ReactNode;
  /** Slot after the title (status badges…) — detail variant. */
  titleExtra?: React.ReactNode;
  /**
   * list: page heading over the canvas. detail: white bar with bottom border.
   * Defaults to detail when onBack is set, list otherwise.
   */
  variant?: 'list' | 'detail';
}

/**
 * Per-screen header. List variant: large title + subtitle left, actions right.
 * Detail variant: white background, back button, leading slot, badges, actions.
 */
function PageHeader({
  title,
  subtitle,
  actions,
  onBack,
  leading,
  titleExtra,
  variant,
  className,
  ...props
}: PageHeaderProps) {
  const resolved = variant ?? (onBack ? 'detail' : 'list');

  if (resolved === 'detail') {
    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-3 border-b border-[#EEF0F3] bg-card px-5 py-[18px] sm:px-7',
          className,
        )}
        {...props}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Retour"
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-input bg-card text-faint transition-colors hover:bg-[#F7F8FA] hover:text-body"
          >
            <ArrowLeft className="size-4" />
          </button>
        )}
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-bold tracking-[-0.02em] text-ink">{title}</h1>
            {titleExtra}
          </div>
          {subtitle && <div className="mt-0.5 text-[13px] text-faint">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn('flex flex-wrap items-end justify-between gap-3 pb-4 pt-6', className)}
      {...props}
    >
      <div className="min-w-0">
        <h1 className="text-[23px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[13.5px] text-faint">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export { PageHeader };
export type { PageHeaderProps };
