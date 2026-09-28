import {
  customAction,
  customCtx,
  customMutation,
  customQuery,
} from 'convex-helpers/server/customFunctions';
import { action, query, type MutationCtx, type QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { authComponent } from '../auth';
// The trigger-wrapped base keeps the aggregates in sync on every write (see _lib/functions.ts).
import { mutation } from './functions';
import { extensions } from '../extensions';
import { loadVisibility, scopedReader, scopedWriter } from '../lib/visibility';

/** Better Auth owns the session (convex/auth.ts); these wrappers resolve the app employee linked to it by `users.authId`, which the `triggers.user.onCreate` hook fills. */

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
  await extensions.beforeEmployeeCall(ctx);
  const session = await loadEmployee(ctx);
  if (!session) throw new Error('Unauthenticated');
  if (!predicate(session.user)) throw new Error(`Unauthorized: ${label}`);
  return session;
}

const isEmployee = (u: Doc<'users'>) => u.type === 'employee';

export const employeeQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const session = await requireRole(ctx, isEmployee, 'employees only');
    const visibility = await loadVisibility(ctx, session.user);
    return { ...session, visibility, db: scopedReader(ctx, visibility) };
  }),
);

/** Settings screens: the role's `settings` switch (admin always has it). */
async function requireSettings(ctx: DbCtx) {
  const session = await requireRole(ctx, isEmployee, 'employees only');
  const visibility = await loadVisibility(ctx, session.user);
  if (!visibility.access.settings) throw new Error('Unauthorized: settings access');
  return { ...session, visibility };
}

export const settingsQuery = customQuery(
  query,
  customCtx(async (ctx) => {
    const session = await requireSettings(ctx);
    return { ...session, db: scopedReader(ctx, session.visibility) };
  }),
);

export const employeeMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const session = await requireRole(ctx, isEmployee, 'employees only');
    const visibility = await loadVisibility(ctx, session.user);
    return { ...session, visibility, db: scopedWriter(ctx, visibility) };
  }),
);

export const settingsMutation = customMutation(
  mutation,
  customCtx(async (ctx) => {
    const session = await requireSettings(ctx);
    return { ...session, db: scopedWriter(ctx, session.visibility) };
  }),
);

/** For actions that call an external API and must not be public: an action has no `ctx.db`, so the employee is looked up through a query. */
export const employeeAction = customAction(
  action,
  customCtx(async (ctx) => {
    await extensions.beforeEmployeeCall(ctx);
    // The identity is resolved on the action ctx and its `authId` passed on: `runQuery` drops the Better Auth `sessionId` claim.
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
