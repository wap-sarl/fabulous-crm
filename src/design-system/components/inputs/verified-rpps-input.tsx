import * as React from 'react';
import { RPPSInput, type RPPSInputProps } from './rpps-input';
import {
  RppsPractitionerCard,
  type RppsPractitionerCardCompareTo,
  type RppsPractitionerData,
} from '../feedback/rpps-practitioner-card';
import { Spinner } from '../feedback/spinner';
import { Collapse } from '../surfaces/collapse';
import { HelperText } from './helper-text';
import { cn } from '../../theme/utils';

export type RppsVerificationResult =
  | { status: 'found'; data: RppsPractitionerData }
  | { status: 'not_found'; message: string }
  | { status: 'error'; message: string };

export interface VerifiedRPPSInputProps extends Omit<RPPSInputProps, 'value' | 'onChange'> {
  value?: string;
  onChange?: (digits: string) => void;
  compareTo?: RppsPractitionerCardCompareTo;
  verify: (digits: string, signal: AbortSignal) => Promise<RppsVerificationResult>;
  debounceMs?: number;
  helperText?: string;
  helperTextVariant?: 'default' | 'error';
  cardVariant?: 'full' | 'simple';
}

const VERIFY_TIMEOUT_MS = 10_000;

type LastState = { kind: 'idle' } | { kind: 'result'; result: RppsVerificationResult };

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function VerifiedRPPSInput({
  value,
  onChange,
  compareTo,
  verify,
  debounceMs = 500,
  helperText,
  helperTextVariant = 'error',
  cardVariant = 'full',
  className,
  ...inputProps
}: VerifiedRPPSInputProps) {
  const digits = (value ?? '').replace(/\D/g, '');
  const ready = digits.length === 11;
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
      .catch((err) => {
        if (controller.signal.aborted) return;
        clearTimeout(timeoutId);
        // Surface the failure instead of swallowing it — a rejected verify (auth,
        // network, server error) must render an error card, not leave the user
        // with no feedback at all.
        console.error('RPPS verification failed', err);
        setLast({
          kind: 'result',
          result: { status: 'error', message: 'Vérification impossible pour le moment.' },
        });
        setFetching(false);
      });
    return () => {
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [debouncedDigits, verify]);

  let data: RppsPractitionerData | null = null;
  let notFound: string | null = null;
  let error: string | null = null;
  if (last.kind === 'result') {
    if (last.result.status === 'found') data = last.result.data;
    else if (last.result.status === 'not_found') notFound = last.result.message;
    else error = last.result.message;
  }

  return (
    <>
      <div>
        <div className="relative">
          <RPPSInput
            {...inputProps}
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
      <RppsPractitionerCard
        data={data}
        compareTo={compareTo}
        notFound={notFound}
        error={error}
        variant={cardVariant}
      />
    </>
  );
}

export { VerifiedRPPSInput };
