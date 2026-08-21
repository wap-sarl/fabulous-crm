import * as React from 'react';
import { Input, type InputProps } from './input';

const RPPS_LENGTH = 11;
const SPACE_AFTER = [1, 4, 7] as const;

interface RPPSInputProps
  extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'maxLength' | 'inputMode' | 'ref'> {
  value?: string;
  onChange?: (digits: string) => void;
  invalid?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}

function formatRpps(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    out += digits[i];
    if ((SPACE_AFTER as readonly number[]).includes(i + 1) && i + 1 < digits.length) {
      out += ' ';
    }
  }
  return out;
}

function digitIndexToFormattedIndex(n: number): number {
  let extra = 0;
  for (const pos of SPACE_AFTER) {
    if (n > pos) extra += 1;
  }
  return n + extra;
}

function countDigitsBefore(formatted: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < caret && i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) count += 1;
  }
  return count;
}

function RPPSInput({
  value,
  onChange,
  invalid,
  placeholder,
  ref,
  onInput,
  ...props
}: RPPSInputProps) {
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const nextCaretRef = React.useRef<number | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
    },
    [ref],
  );

  const digits = React.useMemo(() => {
    const raw = (value ?? '').replace(/\D/g, '');
    return raw.slice(0, RPPS_LENGTH);
  }, [value]);

  const formatted = React.useMemo(() => formatRpps(digits), [digits]);

  React.useLayoutEffect(() => {
    if (nextCaretRef.current != null && innerRef.current) {
      const pos = Math.min(nextCaretRef.current, formatted.length);
      innerRef.current.setSelectionRange(pos, pos);
      nextCaretRef.current = null;
    }
  }, [formatted]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawNext = e.target.value;
    const caret = e.target.selectionStart ?? rawNext.length;
    const digitsBeforeCaret = countDigitsBefore(rawNext, caret);
    const nextDigits = rawNext.replace(/\D/g, '').slice(0, RPPS_LENGTH);
    const clampedDigitIndex = Math.min(digitsBeforeCaret, nextDigits.length);
    nextCaretRef.current = digitIndexToFormattedIndex(clampedDigitIndex);
    onChange?.(nextDigits);
  };

  return (
    <Input
      {...props}
      ref={setRefs}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={formatted}
      onChange={handleChange}
      onInput={onInput}
      invalid={invalid}
      placeholder={placeholder ?? '1 XXX XXX XXXX'}
      maxLength={digitIndexToFormattedIndex(RPPS_LENGTH)}
    />
  );
}

export { RPPSInput, type RPPSInputProps };
