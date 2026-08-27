import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server';
import { wrapDatabaseReader, wrapDatabaseWriter } from 'convex-helpers/server/rowLevelSecurity';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { isNotDeleted } from './dbHelpers';

export type Visibility = { scope: 'all' } | { scope: 'team'; userIds: Set<string> };

const OWNED_TABLES = ['leads', 'companies', 'deals'] as const;
type OwnedTable = (typeof OWNED_TABLES)[number];

export async function loadVisibility(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
): Promise<Visibility> {
  if (user.role !== 'manager') return { scope: 'all' };
  const userIds = new Set<string>([user._id]);
  const teams = await ctx.db.query('teams').collect();
  for (const team of teams) {
    if (!isNotDeleted(team) || !team.memberIds.includes(user._id)) continue;
    for (const id of team.memberIds) userIds.add(id);
  }
  return { scope: 'team', userIds };
}

/** Whether a record with these owners is inside the perimeter. */
export function canSee(visibility: Visibility, ownerIds: Id<'users'>[] | undefined): boolean {
  if (visibility.scope === 'all') return true;
  if (!ownerIds || ownerIds.length === 0) return true;
  return ownerIds.some((id) => visibility.userIds.has(id));
}

type OwnedDoc = { ownerIds?: Id<'users'>[] };

function rulesFor(visibility: Visibility) {
  const rule = async (_ctx: unknown, doc: OwnedDoc) => canSee(visibility, doc.ownerIds);
  return Object.fromEntries(
    OWNED_TABLES.map((table) => [table, { read: rule, modify: rule, insert: rule }]),
  ) as Record<OwnedTable, { read: typeof rule; modify: typeof rule; insert: typeof rule }>;
}

/** The reader every employee query goes through; a no-op for the `all` scope. */
export function scopedReader(
  ctx: QueryCtx,
  visibility: Visibility,
): GenericDatabaseReader<DataModel> {
  if (visibility.scope === 'all') return ctx.db;
  return wrapDatabaseReader(ctx, ctx.db, rulesFor(visibility));
}

/** The writer every employee mutation goes through; a no-op for the `all` scope. */
export function scopedWriter(
  ctx: MutationCtx,
  visibility: Visibility,
): GenericDatabaseWriter<DataModel> {
  if (visibility.scope === 'all') return ctx.db;
  return wrapDatabaseWriter(ctx, ctx.db, rulesFor(visibility));
}
