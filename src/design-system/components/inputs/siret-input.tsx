import * as React from 'react';
import { Input, type InputProps } from './input';
import { countDigitsBefore, digitIndexToFormattedIndex, formatGrouped } from './grouped-digits';

type SIRETMode = 'siren' | 'siret' | 'both';

interface SIRETInputProps
  extends Omit<InputProps, 'value' | 'onChange' | 'type' | 'maxLength' | 'inputMode' | 'ref'> {
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
    [ref],
  );

  const digits = React.useMemo(() => {
    const raw = (value ?? '').replace(/\D/g, '');
    return raw.slice(0, maxLen);
  }, [value, maxLen]);

  const formatted = React.useMemo(() => formatGrouped(digits, SPACE_AFTER), [digits]);

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
    nextCaretRef.current = digitIndexToFormattedIndex(clampedDigitIndex, SPACE_AFTER);
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
      maxLength={digitIndexToFormattedIndex(maxLen, SPACE_AFTER)}
    />
  );
}

export { SIRETInput, type SIRETInputProps };
