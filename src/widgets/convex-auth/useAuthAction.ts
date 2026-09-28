import { useAction } from 'convex/react';
import type { FunctionReference } from 'convex/server';

type AnyAction = FunctionReference<'action', 'public'>;

/** An action of the signed-in user: the Convex client carries the auth, this only names the intent. */
export function useAuthAction<A extends AnyAction>(action: A) {
  return useAction(action);
}
