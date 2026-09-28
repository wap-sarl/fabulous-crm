import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';
import type {
  OptionalRestArgsOrSkip,
  PaginatedQueryArgs,
  PaginatedQueryReference,
  UsePaginatedQueryReturnType,
} from 'convex/react';
import type { FunctionReference, FunctionReturnType } from 'convex/server';

type AnyQuery = FunctionReference<'query', 'public'>;

/** A query that waits for the session: the Convex client carries the auth, nothing is injected here. */
export function useAuthQuery<Q extends AnyQuery>(
  query: Q,
  args: Q['_args'] | 'skip',
): FunctionReturnType<Q> | undefined {
  const { isAuthenticated } = useConvexAuth();
  const finalArgs = args === 'skip' || !isAuthenticated ? 'skip' : args;
  return useQuery(query, ...([finalArgs] as OptionalRestArgsOrSkip<Q>));
}

/** The same for a cursor-paginated query. */
export function useAuthPaginatedQuery<Q extends PaginatedQueryReference>(
  query: Q,
  args: PaginatedQueryArgs<Q> | 'skip',
  options: { initialNumItems: number },
): UsePaginatedQueryReturnType<Q> {
  const { isAuthenticated } = useConvexAuth();
  const finalArgs = args === 'skip' || !isAuthenticated ? 'skip' : args;
  return usePaginatedQuery(query, finalArgs, options);
}
