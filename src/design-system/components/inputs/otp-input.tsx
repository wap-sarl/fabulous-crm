import * as React from 'react';
import { cn } from '../../theme/utils';

export interface OtpInputProps {
  length?: number;
  value?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  autoFocus?: boolean;
  numeric?: boolean;
  className?: string;
}

function OtpInput({
  length = 6,
  value = '',
  onChange,
  onComplete,
  disabled = false,
  error = false,
  autoFocus = false,
  numeric = false,
  className,
  ref,
}: OtpInputProps & { ref?: React.Ref<HTMLDivElement> }) {
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([]);
  const normalize = React.useCallback((v: string) => (numeric ? v : v.toUpperCase()), [numeric]);
  const filterPattern = numeric ? /[^0-9]/g : /[^A-Z0-9]/g;

  const [internalValue, setInternalValue] = React.useState<string[]>(
    normalize(value).split('').slice(0, length),
  );

  React.useEffect(() => {
    const newValue = normalize(value).split('').slice(0, length);
    setInternalValue(newValue);
  }, [value, length, normalize]);

  React.useEffect(() => {
    if (autoFocus && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus]);

  const focusInput = (index: number) => {
    if (index >= 0 && index < length && inputRefs.current[index]) {
      inputRefs.current[index]?.focus();
    }
  };

  const handleChange = (index: number, inputValue: string) => {
    if (disabled) return;

    // Handle paste
    if (inputValue.length > 1) {
      const pastedChars = normalize(inputValue).replace(filterPattern, '').split('');
      const newValue = [...internalValue];

      for (let i = 0; i < pastedChars.length && index + i < length; i++) {
        newValue[index + i] = pastedChars[i];
      }

      setInternalValue(newValue);
      const fullValue = newValue.join('');
      onChange?.(fullValue);

      const nextIndex = Math.min(index + pastedChars.length, length - 1);
      focusInput(nextIndex);

      if (newValue.filter(Boolean).length === length) {
        onComplete?.(fullValue);
      }
      return;
    }

    // Single character input
    const char = normalize(inputValue).replace(filterPattern, '');
    if (!char) return;

    const newValue = [...internalValue];
    newValue[index] = char;
    setInternalValue(newValue);

    const fullValue = newValue.join('');
    onChange?.(fullValue);

    // Move to next input
    if (index < length - 1) {
      focusInput(index + 1);
    }

    // Check if complete
    if (newValue.filter(Boolean).length === length) {
      onComplete?.(fullValue);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      const newValue = [...internalValue];

      if (internalValue[index]) {
        newValue[index] = '';
        setInternalValue(newValue);
        onChange?.(newValue.join(''));
      } else if (index > 0) {
        newValue[index - 1] = '';
        setInternalValue(newValue);
        onChange?.(newValue.join(''));
        focusInput(index - 1);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      focusInput(index + 1);
    }
  };

  const handleFocus = (index: number) => {
    inputRefs.current[index]?.select();
  };

  return (
    <div ref={ref} className={cn('flex gap-2 justify-center', className)}>
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            inputRefs.current[index] = el;
          }}
          type="text"
          inputMode={numeric ? 'numeric' : 'text'}
          autoComplete="one-time-code"
          maxLength={length}
          value={internalValue[index] || ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={() => handleFocus(index)}
          disabled={disabled}
          aria-label={`Code caractère ${index + 1}`}
          className={cn(
            'w-12 h-14 text-center text-2xl font-mono font-semibold',
            !numeric && 'uppercase',
            'rounded-lg border bg-card',
            'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary-soft',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'transition-colors',
            error
              ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/15'
              : 'border-input',
          )}
        />
      ))}
    </div>
  );
}

export { OtpInput };
