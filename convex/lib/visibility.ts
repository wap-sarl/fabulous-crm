import type { GenericDatabaseReader, GenericDatabaseWriter } from 'convex/server';
import {
  type Rules,
  wrapDatabaseReader,
  wrapDatabaseWriter,
} from 'convex-helpers/server/rowLevelSecurity';
import type { DataModel, Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  type AccessLevel,
  type AccessModule,
  type RoleAccess,
  isFullAccess,
} from '../_lib/validators/access';
import { isNotDeleted } from './dbHelpers';
import { resolveRoleAccess } from './roles';

export interface Visibility {
  userId: Id<'users'>;
  role: { key: string; label: string };
  access: RoleAccess;
  /** Members of the user's teams, the user included. */
  teamUserIds: Set<string>;
  teamIds: Set<string>;
  /** Every module at `all`: `ctx.db` is left unwrapped. */
  full: boolean;
}

export async function loadVisibility(
  ctx: QueryCtx | MutationCtx,
  user: Doc<'users'>,
): Promise<Visibility> {
  const role = await resolveRoleAccess(ctx, user.role);
  const teamUserIds = new Set<string>([user._id]);
  const teamIds = new Set<string>();
  const full = isFullAccess(role.access);
  if (!full) {
    const teams = await ctx.db.query('teams').collect();
    for (const team of teams) {
      if (!isNotDeleted(team) || !team.memberIds.includes(user._id)) continue;
      teamIds.add(team._id);
      for (const id of team.memberIds) teamUserIds.add(id);
    }
  }
  return {
    userId: user._id,
    role: { key: role.key, label: role.label },
    access: role.access,
    teamUserIds,
    teamIds,
    full,
  };
}

/** Whether owners `ownerIds` are inside `level` for this user. Empty = pool. */
export function ownersAllowed(
  visibility: Visibility,
  level: AccessLevel,
  ownerIds: readonly Id<'users'>[] | undefined,
): boolean {
  if (level === 'none') return false;
  if (level === 'all') return true;
  if (!ownerIds || ownerIds.length === 0) return true;
  if (level === 'own') return ownerIds.includes(visibility.userId);
  return ownerIds.some((id) => visibility.teamUserIds.has(id));
}

export function moduleAllows(
  visibility: Visibility,
  module: AccessModule,
  ownerIds: readonly Id<'users'>[] | undefined,
): boolean {
  return ownersAllowed(visibility, visibility.access[module], ownerIds);
}

/** Namespaces (primary owners) whose aggregates add up to the user's perimeter, `null` = pool. */
export function ownerNamespaces(
  visibility: Visibility,
  module: AccessModule,
): (Id<'users'> | null)[] | 'all' | 'none' {
  const level = visibility.access[module];
  if (level === 'all') return 'all';
  if (level === 'none') return 'none';
  const owners =
    level === 'own' ? [visibility.userId] : ([...visibility.teamUserIds] as Id<'users'>[]);
  return [...owners, null];
}

const byCreator = (doc: { createdBy?: Id<'users'> }) => (doc.createdBy ? [doc.createdBy] : []);

/**
 * The RLS rules of one request. Parent lookups (a send's campaign, a note's
 * lead…) go through the raw reader and are memoized, so a page of child rows
 * costs one extra read per distinct parent.
 */
function rulesFor(ctx: QueryCtx | MutationCtx, vis: Visibility): Rules<unknown, DataModel> {
  const raw = ctx.db;
  const memo = new Map<string, Promise<boolean>>();
  const cached = (key: string, compute: () => Promise<boolean>) => {
    let p = memo.get(key);
    if (!p) {
      p = compute();
      memo.set(key, p);
    }
    return p;
  };

  const leadOk = (id: Id<'leads'>) =>
    cached(id, async () => {
      const doc = await raw.get(id);
      return !!doc && moduleAllows(vis, 'leads', doc.ownerIds);
    });
  const companyOk = (id: Id<'companies'>) =>
    cached(id, async () => {
      const doc = await raw.get(id);
      return !!doc && moduleAllows(vis, 'companies', doc.ownerIds);
    });
  const dealOk = (id: Id<'deals'>) =>
    cached(id, async () => {
      const doc = await raw.get(id);
      return !!doc && moduleAllows(vis, 'deals', doc.ownerIds);
    });
  const campaignOk = (id: Id<'campaigns'>) =>
    cached(id, async () => {
      const doc = await raw.get(id);
      return !!doc && moduleAllows(vis, 'campaigns', byCreator(doc));
    });
  const workflowOk = (id: Id<'workflows'>) =>
    cached(id, async () => {
      const doc = await raw.get(id);
      return !!doc && moduleAllows(vis, 'workflows', byCreator(doc));
    });
  const runOk = (id: Id<'workflowRuns'>) =>
    cached(id, async () => {
      const run = await raw.get(id);
      return !!run && (await workflowOk(run.workflowId));
    });

  /**
   * A task is visible to its owner, to every member of its team (owner or
   * not), to everyone when it has neither, at `team` level when its owner is
   * a teammate, and whenever it is linked to a visible record.
   */
  const activityOk = async (doc: {
    ownerId?: Id<'users'>;
    teamId?: Id<'teams'>;
    leadId?: Id<'leads'>;
    companyId?: Id<'companies'>;
    dealId?: Id<'deals'>;
  }) => {
    const level = vis.access.activities;
    if (level === 'none') return false;
    if (level === 'all') return true;
    if (doc.ownerId === vis.userId) return true;
    if (doc.teamId && vis.teamIds.has(doc.teamId)) return true;
    if (!doc.ownerId && !doc.teamId) return true;
    if (level === 'team' && doc.ownerId && vis.teamUserIds.has(doc.ownerId)) return true;
    if (doc.leadId && (await leadOk(doc.leadId))) return true;
    if (doc.companyId && (await companyOk(doc.companyId))) return true;
    if (doc.dealId && (await dealOk(doc.dealId))) return true;
    return false;
  };

  const entityOk = (entityType: 'lead' | 'company' | 'deal', entityId: string) => {
    if (entityType === 'lead') {
      const id = raw.normalizeId('leads', entityId);
      return id ? leadOk(id) : Promise.resolve(false);
    }
    if (entityType === 'company') {
      const id = raw.normalizeId('companies', entityId);
      return id ? companyOk(id) : Promise.resolve(false);
    }
    const id = raw.normalizeId('deals', entityId);
    return id ? dealOk(id) : Promise.resolve(false);
  };

  const same = <D>(rule: (doc: D) => Promise<boolean>) => ({
    read: (_ctx: unknown, doc: D) => rule(doc),
    modify: (_ctx: unknown, doc: D) => rule(doc),
    insert: (_ctx: unknown, doc: D) => rule(doc),
  });

  return {
    leads: same(async (d: { ownerIds: Id<'users'>[] }) => moduleAllows(vis, 'leads', d.ownerIds)),
    companies: same(async (d: { ownerIds: Id<'users'>[] }) =>
      moduleAllows(vis, 'companies', d.ownerIds),
    ),
    deals: same(async (d: { ownerIds: Id<'users'>[] }) => moduleAllows(vis, 'deals', d.ownerIds)),
    activities: same(activityOk),
    campaigns: same(async (d: { createdBy?: Id<'users'> }) =>
      moduleAllows(vis, 'campaigns', byCreator(d)),
    ),
    campaignSends: same((d: { campaignId: Id<'campaigns'> }) => campaignOk(d.campaignId)),
    campaignEvents: same((d: { campaignId: Id<'campaigns'> }) => campaignOk(d.campaignId)),
    campaignLinkTokens: same((d: { campaignId: Id<'campaigns'> }) => campaignOk(d.campaignId)),
    workflows: same(async (d: { createdBy?: Id<'users'> }) =>
      moduleAllows(vis, 'workflows', byCreator(d)),
    ),
    workflowRuns: same((d: { workflowId: Id<'workflows'> }) => workflowOk(d.workflowId)),
    workflowRunSteps: same((d: { runId: Id<'workflowRuns'> }) => runOk(d.runId)),
    attachments: same((d: { entityType: 'lead' | 'company' | 'deal'; entityId: string }) =>
      entityOk(d.entityType, d.entityId),
    ),
    leadNotes: same((d: { leadId: Id<'leads'> }) => leadOk(d.leadId)),
    lifecycleStageHistory: same((d: { leadId: Id<'leads'> }) => leadOk(d.leadId)),
    leadDuplicates: same(
      async (d: { leadAId: Id<'leads'>; leadBId: Id<'leads'> }) =>
        (await leadOk(d.leadAId)) && (await leadOk(d.leadBId)),
    ),
    leadLists: same(async (d: { createdBy?: Id<'users'> }) =>
      moduleAllows(vis, 'leads', byCreator(d)),
    ),
    leadListMembers: same((d: { leadId: Id<'leads'> }) => leadOk(d.leadId)),
  } as Rules<unknown, DataModel>;
}

/** The reader every employee query goes through; a no-op for full access. */
export function scopedReader(
  ctx: QueryCtx,
  visibility: Visibility,
): GenericDatabaseReader<DataModel> {
  if (visibility.full) return ctx.db;
  return wrapDatabaseReader(ctx, ctx.db, rulesFor(ctx, visibility));
}

/** The writer every employee mutation goes through; a no-op for full access. */
export function scopedWriter(
  ctx: MutationCtx,
  visibility: Visibility,
): GenericDatabaseWriter<DataModel> {
  if (visibility.full) return ctx.db;
  return wrapDatabaseWriter(ctx, ctx.db, rulesFor(ctx, visibility));
}
