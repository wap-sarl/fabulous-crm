import * as React from 'react';
import { SIRETInput, type SIRETInputProps } from './siret-input';
import {
  SiretCompanyCard,
  type SiretCompanyCardCompareTo,
  type SiretCompanyData,
} from '../feedback/siret-company-card';
import { Spinner } from '../feedback/spinner';
import { Collapse } from '../surfaces/collapse';
import { HelperText } from './helper-text';
import { cn } from '../../theme/utils';

export type SiretVerificationResult =
  | { status: 'found'; data: SiretCompanyData }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string };

export interface VerifiedSIRETInputProps extends Omit<SIRETInputProps, 'value' | 'onChange'> {
  value?: string;
  onChange?: (digits: string) => void;
  compareTo?: SiretCompanyCardCompareTo;
  verify: (digits: string, signal: AbortSignal) => Promise<SiretVerificationResult>;
  debounceMs?: number;
  helperText?: string;
  helperTextVariant?: 'default' | 'error';
}

const VERIFY_TIMEOUT_MS = 10_000;

type LastState = { kind: 'idle' } | { kind: 'result'; result: SiretVerificationResult };

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function VerifiedSIRETInput({
  value,
  onChange,
  compareTo,
  verify,
  debounceMs = 500,
  mode = 'both',
  helperText,
  helperTextVariant = 'error',
  className,
  ...inputProps
}: VerifiedSIRETInputProps) {
  const digits = (value ?? '').replace(/\D/g, '');
  const ready =
    (mode === 'siren' && digits.length === 9) ||
    (mode === 'siret' && digits.length === 14) ||
    (mode === 'both' && (digits.length === 9 || digits.length === 14));
  const showHelper = !!helperText && digits.length > 0 && !ready;
  const debouncedDigits = useDebouncedValue(ready ? digits : '', debounceMs);
  const [last, setLast] = React.useState<LastState>({ kind: 'idle' });
  const [fetching, setFetching] = React.useState(false);

  React.useEffect(() => {
    if (!debouncedDigits) {
      setLast({ kind: 'idle' });
      setFetching(false);
      return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      setFetching(false);
    }, VERIFY_TIMEOUT_MS);
    setFetching(true);
    verify(debouncedDigits, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        clearTimeout(timeoutId);
        setLast({ kind: 'result', result });
        setFetching(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        clearTimeout(timeoutId);
        setFetching(false);
      });
    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [debouncedDigits, verify]);

  let data: SiretCompanyData | null = null;
  let notFound: string | null = null;
  if (last.kind === 'result') {
    if (last.result.status === 'found') data = last.result.data;
    else if (last.result.status === 'not_found') notFound = last.result.message;
  }

  return (
    <>
      <div>
        <div className="relative">
          <SIRETInput
            {...inputProps}
            mode={mode}
            value={value}
            onChange={onChange}
            className={cn('pr-10', className)}
          />
          {fetching && (
            <Spinner
              size="sm"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          )}
        </div>
        <Collapse open={showHelper}>
          <HelperText variant={helperTextVariant === 'error' ? 'error' : 'default'}>
            {helperText}
          </HelperText>
        </Collapse>
      </div>
      <SiretCompanyCard data={data} compareTo={compareTo} notFound={notFound} />
    </>
  );
}

export { VerifiedSIRETInput };
