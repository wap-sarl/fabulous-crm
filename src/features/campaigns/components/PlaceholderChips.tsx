import { cn } from '@crm/design-system';
import { Braces, Link2 } from 'lucide-react';
import type { PlaceholderItem } from '../lib/placeholders';

interface Props {
  placeholders: PlaceholderItem[];
  onInsert: (item: PlaceholderItem) => void;
  className?: string;
}

/**
 * Click-to-insert placeholder chips shown under a campaign message field.
 * Clicking a chip inserts its {{ params.x }} token at the field's caret
 * (via `onInsert`, owned by the parent which holds the input ref).
 */
export function PlaceholderChips({ placeholders, onInsert, className }: Props) {
  if (placeholders.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {placeholders.map((item) => {
        const Icon = item.kind === 'link' ? Link2 : Braces;
        return (
          <button
            key={item.key}
            type="button"
            title={item.token}
            onClick={() => onInsert(item)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft',
              item.kind === 'link'
                ? 'border-primary/40 bg-primary-soft/40 text-primary hover:bg-primary-soft'
                : 'border-border bg-muted/40 text-faint hover:bg-muted hover:text-ink',
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
