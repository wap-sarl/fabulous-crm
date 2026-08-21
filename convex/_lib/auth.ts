import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from 'convex-helpers/server/customFunctions';
import { action, mutation, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';

/**
 * Authentication seam. Better Auth owns the session (see convex/auth.ts); these
 * wrappers resolve the current *app employee* from the Better Auth identity and
 * inject `{ userId, user }` into the handler ctx — the same shape handlers relied
 * on under the old token-based scheme, so call sites are unchanged.
 *
 * The employee is linked to the Better Auth user via `users.authId`
 * (`by_authId` index), populated by the `triggers.user.onCreate` hook.
 */

type DbCtx = QueryCtx | MutationCtx;

/** Resolve the app employee for the current session, or `null` when signed out. */
async function loadEmployee(
  ctx: DbCtx,
): Promise<{ userId: Id<'users'>; user: Doc<'users'> } | null> {
  const authUser = await authComponent.safeGetAuthUser(ctx);
  if (!authUser) return null;
  const user = await ctx.db
    .query('users')
    .withIndex('by_authId', (q) => q.eq('authId', authUser._id))
    .first();
  if (!user || user.deletedAt) return null;
  return { userId: user._id, user };
}

/** Resolve the employee and enforce a role predicate, or throw. */
async function requireRole(
  ctx: DbCtx,
  predicate: (u: Doc<'users'>) => boolean,
  label: string,
): Promise<{ userId: Id<'users'>; user: Doc<'users'> }> {
  const session = await loadEmployee(ctx);
  if (!session) throw new Error('Unauthenticated');
  if (!predicate(session.user)) throw new Error(`Unauthorized: ${label}`);
  return session;
}

const isEmployee = (u: Doc<'users'>) => u.type === 'employee';
const isAdmin = (u: Doc<'users'>) => u.type === 'employee' && u.role === 'admin';

export const employeeQuery = customQuery(
  query,
  customCtx((ctx) => requireRole(ctx, isEmployee, 'employees only')),
);

export const adminQuery = customQuery(
  query,
  customCtx((ctx) => requireRole(ctx, isAdmin, 'admins only')),
);

export const employeeMutation = customMutation(
  mutation,
  customCtx((ctx) => requireRole(ctx, isEmployee, 'employees only')),
);

export const adminMutation = customMutation(
  mutation,
  customCtx((ctx) => requireRole(ctx, isAdmin, 'admins only')),
);

/**
 * Authenticated action. Actions have no `ctx.db`, so the query/mutation
 * `loadEmployee` path (above) can't run here. Instead we gate on `getCurrentUser`
 * (which resolves the linked employee from the Better Auth session via
 * `ctx.runQuery`); a non-null result means the caller is a signed-in employee.
 * Used by external-API actions (e.g. RPPS verification) that must not be public.
 */
export const employeeAction = customAction(
  action,
  customCtx(async (ctx) => {
    // Resolve the identity on the *action* ctx (where the Better Auth `sessionId`
    // claim is present) rather than re-entering a query via `runQuery` — the
    // latter drops the claim, so `getCurrentUser` would return null here. The
    // employee lookup needs the DB, so pass the resolved `authId` explicitly.
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) throw new Error('Unauthorized: employees only');
    const employee = await ctx.runQuery(internal.auth.getEmployeeByAuthId, {
      authId: authUser._id,
    });
    if (employee?.type !== 'employee') {
      throw new Error('Unauthorized: employees only');
    }
    return {};
  }),
);

export function assertSelfOrEmployee(
  ctx: { userId: Id<'users'>; user: Doc<'users'> },
  targetId: Id<'users'>,
  message = 'Unauthorized: can only access your own profile',
) {
  if (targetId !== ctx.userId && ctx.user.type !== 'employee') {
    throw new Error(message);
  }
}
