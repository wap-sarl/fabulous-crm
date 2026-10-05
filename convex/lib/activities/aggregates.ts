import { TableAggregate } from '@convex-dev/aggregate';
import { components } from '../../_generated/api';
import type { DataModel, Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { whenMoved } from '../shared/aggregates';
import { activityDueKey, type ActivityStatus } from '../../_lib/validators/activities';

const ownerNamespace = (
  ownerId: Id<'users'> | undefined,
  status: ActivityStatus,
  deleted: boolean,
) => `${ownerId ?? 'none'}|${status}|${deleted ? 'deleted' : 'live'}`;

const teamNamespace = (teamId: Id<'teams'> | undefined, status: ActivityStatus, deleted: boolean) =>
  `${teamId ?? 'none'}|${status}|${deleted ? 'deleted' : 'live'}`;

const activitiesByOwnerPlace = {
  namespace: (doc: Doc<'activities'>) =>
    ownerNamespace(doc.ownerId, doc.status, doc.deletedAt != null),
  sortKey: activityDueKey,
};
const activitiesByOwner = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: 'activities';
}>(components.activitiesByOwner, activitiesByOwnerPlace);
export const activitiesByOwnerTrigger = whenMoved(
  activitiesByOwner.idempotentTrigger<MutationCtx>(),
  activitiesByOwnerPlace,
);

/** Same shape per team: the « Mon équipe » buckets of the tasks assigned to a team. */
const activitiesByTeamPlace = {
  namespace: (doc: Doc<'activities'>) =>
    teamNamespace(doc.teamId, doc.status, doc.deletedAt != null),
  sortKey: activityDueKey,
};
const activitiesByTeam = new TableAggregate<{
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: 'activities';
}>(components.activitiesByTeam, activitiesByTeamPlace);
export const activitiesByTeamTrigger = whenMoved(
  activitiesByTeam.idempotentTrigger<MutationCtx>(),
  activitiesByTeamPlace,
);

/** Live activities assigned to `teamId` in `status` whose due key is in [from, to). */
export async function countTeamActivitiesDue(
  ctx: QueryCtx,
  teamId: Id<'teams'>,
  status: ActivityStatus,
  from: number,
  to: number,
): Promise<number> {
  return await activitiesByTeam.count(ctx, {
    namespace: teamNamespace(teamId, status, false),
    bounds: { lower: { key: from, inclusive: true }, upper: { key: to, inclusive: false } },
  });
}

/** Live activities of `owner` in `status` whose due key is in [from, to). */
export async function countActivitiesDue(
  ctx: QueryCtx,
  ownerId: Id<'users'>,
  status: ActivityStatus,
  from: number,
  to: number,
): Promise<number> {
  return await activitiesByOwner.count(ctx, {
    namespace: ownerNamespace(ownerId, status, false),
    bounds: { lower: { key: from, inclusive: true }, upper: { key: to, inclusive: false } },
  });
}
