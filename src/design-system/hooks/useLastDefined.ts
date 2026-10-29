import { useRef } from 'react';

/** The last value that was not `undefined`: a query's previous answer stands in while its arguments change and the new one is on its way, so what it feeds does not blink back to a placeholder. */
export function useLastDefined<T>(value: T | undefined): T | undefined {
  const last = useRef(value);
  if (value !== undefined) last.current = value;
  return last.current;
}
