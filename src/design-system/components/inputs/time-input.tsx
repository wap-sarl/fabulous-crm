import * as React from 'react';
import { cn } from '../../theme/utils';

interface TimeInputProps extends Omit<
  React.ComponentProps<'input'>,
  'onChange' | 'value' | 'type'
> {
  value?: string;
  onValueChange?: (value: string) => void;
  invalid?: boolean;
}

function TimeInput({
  className,
  value = '',
  onValueChange,
  invalid,
  ref,
  ...props
}: TimeInputProps & { ref?: React.Ref<HTMLInputElement> }) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/[^\d]/g, '');

    if (digits.length === 0) {
      onValueChange?.('');
      return;
    }

    if (digits.length <= 2) {
      onValueChange?.(digits);
      return;
    }

    const hours = digits.slice(0, 2);
    const minutes = digits.slice(2, 4);

    // Clamp hours to 23, minutes to 59
    const h = Math.min(parseInt(hours, 10), 23);
    const m = Math.min(parseInt(minutes, 10), 59);

    onValueChange?.(
      `${String(h).padStart(2, '0')}:${minutes.length === 1 ? minutes : String(m).padStart(2, '0')}`
    );
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      maxLength={5}
      value={value}
      onChange={handleChange}
      className={cn(
        'flex h-9.5 w-full rounded-lg border border-input bg-card px-3 py-2 text-base placeholder:text-placeholder focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        invalid &&
          'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/15',
        className
      )}
      ref={ref}
      {...props}
    />
  );
}

export { TimeInput, type TimeInputProps };
