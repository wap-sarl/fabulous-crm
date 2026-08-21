import { useCallback } from 'react';
import { useAction } from 'convex/react';
import type { FunctionReference, FunctionReturnType } from 'convex/server';
import { useGuestToken } from './TokenContext';

type AnyAction = FunctionReference<'action', 'public'>;
type GuestedAction = FunctionReference<
  'action',
  'public',
  { guestToken: string } & Record<string, unknown>
>;

type GuestActionArgs<A extends GuestedAction> = Omit<A['_args'], 'guestToken'>;

/**
 * Authenticated action. Auth is carried by the Convex client (Better Auth
 * session), so this is a thin passthrough over `useAction`.
 */
export function useAuthAction<A extends AnyAction>(action: A) {
  return useAction(action);
}

export function useGuestAction<A extends GuestedAction>(
  action: A,
): (args: GuestActionArgs<A>) => Promise<FunctionReturnType<A>> {
  const guestToken = useGuestToken();
  const fn = useAction(action);
  return useCallback(
    (args: GuestActionArgs<A>) => {
      if (!guestToken) {
        throw new Error('No guest token');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn({ ...args, guestToken } as any);
    },
    [fn, guestToken],
  );
}
