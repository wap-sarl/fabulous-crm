import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

/** Where the selected button sits in the list: what the moving pill is given. */
interface PillPlace {
  left: number;
  width: number;
}

const samePlace = (a: PillPlace | null, b: PillPlace) =>
  a !== null && a.left === b.left && a.width === b.width;

/** A row of buttons, one pressed: a filter, not tabs, so each button is a plain tab stop that says whether it is pressed; the light pill slides from the old one to the new, the selection itself changes at once. */
function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  className,
  ...props
}: SegmentedControlProps<T>) {
  const listRef = useRef<HTMLFieldSetElement>(null);
  const [pill, setPill] = useState<PillPlace | null>(null);
  // The pill moves only once it has been placed: on the first display it must appear where it is, not slide in from the left.
  const [placed, setPlaced] = useState(false);
  const selectedIndex = items.findIndex((item) => item.value === value);
  // What the buttons are made of: callers build `items` on each render, the observer is rebuilt only when a button changes.
  const buttonsKey = items
    .map((item) => `${item.value}:${item.label}:${item.count ?? ''}`)
    .join('|');

  // Measured before paint, so the pill is in place on the first frame; measured again when a button is resized (a count that grows, a font that loads).
  // biome-ignore lint/correctness/useExhaustiveDependencies(buttonsKey): the buttons changed, the observer must watch the new ones
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      // The pill is the first child; the buttons follow in the order of the items.
      const selected =
        selectedIndex < 0 ? null : (list.children[selectedIndex + 1] as HTMLElement | undefined);
      if (!selected) return;
      const place = { left: selected.offsetLeft, width: selected.offsetWidth };
      setPill((current) => (samePlace(current, place) ? current : place));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    // The list and each button: a list that overflows keeps its width when a button changes its own.
    for (const child of [list, ...list.children]) observer.observe(child);
    return () => observer.disconnect();
  }, [selectedIndex, buttonsKey]);

  useEffect(() => {
    if (pill) setPlaced(true);
  }, [pill]);

  return (
    <fieldset
      ref={listRef}
      className={cn(
        // `min-w-0`: a fieldset refuses to shrink below its content by default, which would defeat the scrolling.
        'relative inline-flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto rounded-[11px] bg-secondary p-1',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="segmented-pill"
        className={cn(
          'absolute inset-y-1 left-0 rounded-lg bg-card shadow-[0_1px_2px_rgba(16,18,28,0.12)]',
          placed &&
            'transition-[transform,width] duration-200 ease-out motion-reduce:transition-none',
          pill === null && 'opacity-0',
        )}
        style={pill ? { transform: `translateX(${pill.left}px)`, width: pill.width } : undefined}
      />
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative z-10 inline-flex h-[30px] cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors',
              active ? 'text-ink' : 'text-soft hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="font-mono text-[11px] font-medium opacity-65">{item.count}</span>
            )}
          </button>
        );
      })}
    </fieldset>
  );
}

export { SegmentedControl };
