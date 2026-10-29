import type * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../theme/utils';
import { Skeleton } from '../feedback/skeleton';

interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** The subtitle depends on data still on its way: its line is kept, with a placeholder, so the header does not grow when the data lands. */
  loading?: boolean;
  /** Right-aligned actions (buttons). */
  actions?: React.ReactNode;
  /** Renders the detail variant with a back button when provided. */
  onBack?: () => void;
  /** Slot before the title (avatar, icon…) — detail variant. */
  leading?: React.ReactNode;
  /** Slot after the title (status badges…) — detail variant. */
  titleExtra?: React.ReactNode;
  /** Defaults to detail when onBack is set, list otherwise. */
  variant?: 'list' | 'detail';
}

function PageHeader({
  title,
  subtitle,
  loading = false,
  actions,
  onBack,
  leading,
  titleExtra,
  variant,
  className,
  ...props
}: PageHeaderProps) {
  const resolved = variant ?? (onBack ? 'detail' : 'list');
  // One line box whether the subtitle is text or still a placeholder; a longer subtitle wraps and grows it as text does. A plain block, not a flex container: text mixed with elements keeps its spaces.
  const subtitleLine = (size: string) =>
    (subtitle || loading) && (
      <div className={cn('mt-0.5 min-h-5 text-faint', size)}>
        {subtitle ?? (
          <Skeleton
            className="inline-block h-3 w-56 max-w-full align-middle"
            data-slot="subtitle-placeholder"
          />
        )}
      </div>
    );

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
        {/* A fixed basis: whether the row wraps depends on the width and the actions, never on what the subtitle holds. */}
        <div className="min-w-0 flex-[1_1_12rem]">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-xl font-bold tracking-[-0.02em] text-ink">{title}</h1>
            {titleExtra}
          </div>
          {subtitleLine('text-[13px]/5')}
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
      {/* A fixed basis: whether the row wraps depends on the width and the actions, never on what the subtitle holds. */}
      <div className="min-w-0 flex-[1_1_12rem]">
        <h1 className="text-[23px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitleLine('text-[13.5px]/5')}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export { PageHeader };
