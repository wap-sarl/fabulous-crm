import { useAuthQuery } from '@crm/widgets';
import { api } from '@crm/lib/backend';

/** Live teams with their members, for task assignment and « Mon équipe » views. */
export function useTeams() {
  const teams = useAuthQuery(api.features.teams.queries.listTeams, {});
  return {
    teams: teams ?? [],
    isLoading: teams === undefined,
    /** The teams the given user belongs to. */
    teamsOf: (userId: string | undefined) =>
      userId ? (teams ?? []).filter((t) => (t.memberIds as string[]).includes(userId)) : [],
  };
}
