import type * as React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '../../theme/utils';

export interface SortableListProps<T> {
  items: T[];
  /** Stable id of an item (the sortable key). */
  getId: (item: T) => string;
  /** Called with the reordered array after a drop. */
  onReorder: (items: T[]) => void;
  /** Render one row; `handle` is the grip to place wherever the row wants it. */
  renderItem: (item: T, index: number, handle: React.ReactNode) => React.ReactNode;
  /** Items that cannot be dragged nor displaced (pinned in place). */
  isLocked?: (item: T) => boolean;
  className?: string;
  itemClassName?: string;
  disabled?: boolean;
}

function SortableRow({
  id,
  locked,
  disabled,
  className,
  children,
}: {
  id: string;
  locked: boolean;
  disabled: boolean;
  className?: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: locked || disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Réordonner"
      disabled={locked || disabled}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md text-placeholder transition-colors',
        locked || disabled
          ? 'cursor-default opacity-30'
          : 'cursor-grab hover:bg-muted hover:text-soft active:cursor-grabbing',
      )}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(className, isDragging && 'relative z-10 opacity-80 shadow-card-hover')}
    >
      {children(handle)}
    </li>
  );
}

/**
 * Vertical drag-and-drop reorderable list (dnd-kit): each row gets a six-dot
 * grip handle; keyboard reordering works through the handle (space, arrows).
 * Locked items keep their position: a drop that would displace one is
 * ignored, so e.g. pinned trailing rows stay trailing.
 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  isLocked,
  className,
  itemClassName,
  disabled = false,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const next = arrayMove(items, from, to);
    // A locked item must end up exactly where it was.
    if (isLocked && items.some((item, i) => isLocked(item) && next[i] !== item)) return;
    onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={cn('flex flex-col gap-2', className)}>
          {items.map((item, index) => (
            <SortableRow
              key={ids[index]}
              id={ids[index]}
              locked={!!isLocked?.(item)}
              disabled={disabled}
              className={itemClassName}
            >
              {(handle) => renderItem(item, index, handle)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
