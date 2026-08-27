import { type Infer, v } from 'convex/values';

export const ACCESS_MODULES = [
  'leads',
  'companies',
  'deals',
  'activities',
  'campaigns',
  'workflows',
] as const;
export type AccessModule = (typeof ACCESS_MODULES)[number];

export const accessLevelValidator = v.union(
  v.literal('none'),
  v.literal('own'),
  v.literal('team'),
  v.literal('all'),
);
export type AccessLevel = Infer<typeof accessLevelValidator>;

export const ACCESS_LEVELS: AccessLevel[] = ['none', 'own', 'team', 'all'];

export const roleAccessValidator = v.object({
  leads: accessLevelValidator,
  companies: accessLevelValidator,
  deals: accessLevelValidator,
  activities: accessLevelValidator,
  campaigns: accessLevelValidator,
  workflows: accessLevelValidator,
  settings: v.boolean(),
});
export type RoleAccess = Infer<typeof roleAccessValidator>;

/** Every module at one level. */
export function uniformAccess(level: AccessLevel, settings: boolean): RoleAccess {
  return {
    leads: level,
    companies: level,
    deals: level,
    activities: level,
    campaigns: level,
    workflows: level,
    settings,
  };
}

/** A role sees the whole CRM: the RLS wrapper is skipped entirely. */
export function isFullAccess(access: RoleAccess): boolean {
  return ACCESS_MODULES.every((m) => access[m] === 'all');
}

export type AccessWarning =
  | { code: 'no_records'; roleKey: string }
  | { code: 'team_without_team'; roleKey: string }
  | { code: 'own_settings_lost'; roleKey: string };

export function accessWarnings(
  roles: { key: string; access: RoleAccess }[],
  opts: { callerRoleKey: string; rolesWithoutTeamMembers?: Set<string> },
): AccessWarning[] {
  const out: AccessWarning[] = [];
  for (const role of roles) {
    const levels = ACCESS_MODULES.map((m) => role.access[m]);
    if (levels.every((l) => l === 'none')) out.push({ code: 'no_records', roleKey: role.key });
    if (levels.includes('team') && opts.rolesWithoutTeamMembers?.has(role.key)) {
      out.push({ code: 'team_without_team', roleKey: role.key });
    }
    if (role.key === opts.callerRoleKey && !role.access.settings) {
      out.push({ code: 'own_settings_lost', roleKey: role.key });
    }
  }
  return out;
}
