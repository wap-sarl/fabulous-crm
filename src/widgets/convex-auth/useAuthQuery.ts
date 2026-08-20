import { useQuery, usePaginatedQuery, useConvexAuth } from 'convex/react';
import type {
  PaginatedQueryArgs,
  PaginatedQueryReference,
  UsePaginatedQueryReturnType,
} from 'convex/react';
import type { FunctionReference, FunctionReturnType } from 'convex/server';
import { useGuestToken } from './TokenContext';

type AnyQuery = FunctionReference<'query', 'public'>;
type GuestedQuery = FunctionReference<
  'query',
  'public',
  { guestToken: string } & Record<string, unknown>
>;

type GuestQueryArgs<Q extends GuestedQuery> = Omit<Q['_args'], 'guestToken'>;

/**
 * Authenticated query. Auth is carried by the Convex client (Better Auth session
 * via ConvexBetterAuthProvider), so no token is injected — this only defers the
 * query until the session is ready, avoiding an unauthenticated call.
 */
export function useAuthQuery<Q extends AnyQuery>(
  query: Q,
  args: Q['_args'] | 'skip'
): FunctionReturnType<Q> | undefined {
  const { isAuthenticated } = useConvexAuth();
  const finalArgs = args === 'skip' || !isAuthenticated ? 'skip' : args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery(query, finalArgs as any);
}

/**
 * Authenticated cursor-paginated query (Convex usePaginatedQuery). Like
 * useAuthQuery, it only defers until the Better Auth session is ready.
 */
export function useAuthPaginatedQuery<Q extends PaginatedQueryReference>(
  query: Q,
  args: PaginatedQueryArgs<Q> | 'skip',
  options: { initialNumItems: number }
): UsePaginatedQueryReturnType<Q> {
  const { isAuthenticated } = useConvexAuth();
  const finalArgs = args === 'skip' || !isAuthenticated ? 'skip' : args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return usePaginatedQuery(query, finalArgs as any, options);
}

/**
 * Wraps useQuery, auto-injecting the guest invitation token from TokenContext.
 * Skips when no guest token is available, or when caller passes 'skip'.
 */
export function useGuestQuery<Q extends GuestedQuery>(
  query: Q,
  args: GuestQueryArgs<Q> | 'skip'
): FunctionReturnType<Q> | undefined {
  const guestToken = useGuestToken();
  const finalArgs = args === 'skip' || !guestToken ? 'skip' : { ...args, guestToken };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useQuery(query, finalArgs as any);
}
