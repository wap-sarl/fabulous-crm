import { useId } from 'react';
import { cn } from '../../theme/utils';
import { Switch } from './switch';

interface SwitchRowProps {
  label: string;
  /** What the setting does, under its label. */
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** A setting that is on or off: its label and what it does on the left, the switch on the right; the label toggles it too. */
function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchRowProps) {
  const id = useId();
  return (
    <div
      data-slot="switch-row"
      className={cn('flex items-center justify-between gap-4 py-3', className)}
    >
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={cn(
            'block text-sm font-medium text-ink',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          )}
        >
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="mt-0.5 text-[13px] text-soft">
            {description}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
      />
    </div>
  );
}

export { SwitchRow };
