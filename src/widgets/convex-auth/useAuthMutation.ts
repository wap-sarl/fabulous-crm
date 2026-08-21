import { useCallback } from 'react';
import { useMutation } from 'convex/react';
import type { FunctionReference, FunctionReturnType } from 'convex/server';
import { useGuestToken } from './TokenContext';

type AnyMutation = FunctionReference<'mutation', 'public'>;
type GuestedMutation = FunctionReference<
  'mutation',
  'public',
  { guestToken: string } & Record<string, unknown>
>;

type GuestMutationArgs<M extends GuestedMutation> = Omit<M['_args'], 'guestToken'>;

/**
 * Authenticated mutation. Auth is carried by the Convex client (Better Auth
 * session), so this is a thin passthrough over `useMutation`.
 */
export function useAuthMutation<M extends AnyMutation>(mutation: M) {
  return useMutation(mutation);
}

export function useGuestMutation<M extends GuestedMutation>(
  mutation: M,
): (args: GuestMutationArgs<M>) => Promise<FunctionReturnType<M>> {
  const guestToken = useGuestToken();
  const fn = useMutation(mutation);
  return useCallback(
    (args: GuestMutationArgs<M>) => {
      if (!guestToken) {
        throw new Error('No guest token');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fn({ ...args, guestToken } as any);
    },
    [fn, guestToken],
  );
}
