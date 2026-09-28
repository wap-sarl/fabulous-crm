import { useMutation } from 'convex/react';
import type { FunctionReference } from 'convex/server';

type AnyMutation = FunctionReference<'mutation', 'public'>;

/** A mutation of the signed-in user: the Convex client carries the auth, this only names the intent. */
export function useAuthMutation<M extends AnyMutation>(mutation: M) {
  return useMutation(mutation);
}
