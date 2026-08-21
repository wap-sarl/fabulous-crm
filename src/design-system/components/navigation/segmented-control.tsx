import { cn } from '../../theme/utils';

interface SegmentedControlItem<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface SegmentedControlProps<T extends string> {
  items: SegmentedControlItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

/**
 * Filter chips on a gray track — single-select. Active chip is white with a
 * subtle shadow; optional mono counts.
 */
function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  className,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[11px] bg-secondary p-1',
        className,
      )}
      {...props}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-all',
              active
                ? 'bg-card text-ink shadow-[0_1px_2px_rgba(16,18,28,0.12)]'
                : 'text-soft hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="font-mono text-[11px] font-medium opacity-65">{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export { SegmentedControl };
export type { SegmentedControlProps, SegmentedControlItem };
