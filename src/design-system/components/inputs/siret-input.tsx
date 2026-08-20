import * as React from 'react';
import { Input, type InputProps } from './input';

type SIRETMode = 'siren' | 'siret' | 'both';

interface SIRETInputProps extends Omit<
  InputProps,
  'value' | 'onChange' | 'type' | 'maxLength' | 'inputMode' | 'ref'
> {
  value?: string;
  onChange?: (digits: string) => void;
  mode?: SIRETMode;
  invalid?: boolean;
  ref?: React.Ref<HTMLInputElement>;
}

const SPACE_AFTER = [3, 6, 9] as const;

function maxLenFor(mode: SIRETMode): number {
  return mode === 'siren' ? 9 : 14;
}

function formatSiret(digits: string): string {
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

function SIRETInput({
  value,
  onChange,
  mode = 'both',
  invalid,
  placeholder,
  ref,
  onInput,
  ...props
}: SIRETInputProps) {
  const maxLen = maxLenFor(mode);
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const nextCaretRef = React.useRef<number | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = node;
    },
    [ref]
  );

  const digits = React.useMemo(() => {
    const raw = (value ?? '').replace(/\D/g, '');
    return raw.slice(0, maxLen);
  }, [value, maxLen]);

  const formatted = React.useMemo(() => formatSiret(digits), [digits]);

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
    const nextDigits = rawNext.replace(/\D/g, '').slice(0, maxLen);
    const clampedDigitIndex = Math.min(digitsBeforeCaret, nextDigits.length);
    nextCaretRef.current = digitIndexToFormattedIndex(clampedDigitIndex);
    onChange?.(nextDigits);
  };

  const placeholderDefault = mode === 'siren' ? 'XXX XXX XXX' : 'XXX XXX XXX XXXXX';

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
      placeholder={placeholder ?? placeholderDefault}
      maxLength={digitIndexToFormattedIndex(maxLen)}
    />
  );
}

export { SIRETInput, type SIRETInputProps, type SIRETMode };
