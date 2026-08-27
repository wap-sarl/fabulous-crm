import type { AccessLevel, AccessModule, AccessWarning, RoleAccess } from '@crm/lib/backend';

export const ACCESS_MODULE_LABEL: Record<AccessModule, string> = {
  leads: 'Leads',
  companies: 'Entreprises',
  deals: 'Transactions',
  activities: 'Activités',
  campaigns: 'Campagnes',
  workflows: 'Workflows',
};

export const ACCESS_LEVEL_LABEL: Record<AccessLevel, string> = {
  none: 'Aucun',
  own: 'Mes fiches',
  team: 'Mon équipe',
  all: 'Tout',
};

/** Top-level route → module, for navigation and route guards. */
export const MODULE_OF_PATH: Record<string, AccessModule> = {
  '/leads': 'leads',
  '/companies': 'companies',
  '/deals': 'deals',
  '/tasks': 'activities',
  '/campaigns': 'campaigns',
  '/workflows': 'workflows',
};

export function moduleOfPath(path: string): AccessModule | undefined {
  return MODULE_OF_PATH[`/${path.split('/')[1] ?? ''}`];
}

/** Whether the module is usable at all for this access. */
export function canAccessModule(access: RoleAccess | undefined, module: AccessModule): boolean {
  return !!access && access[module] !== 'none';
}

export function accessWarningMessage(warning: AccessWarning, roleLabel: string): string {
  switch (warning.code) {
    case 'no_records':
      return `« ${roleLabel} » ne voit aucun module : ses utilisateurs n’auront que la page d’accueil.`;
    case 'team_without_team':
      return `« ${roleLabel} » a un niveau « Mon équipe » mais certains de ses utilisateurs ne sont dans aucune équipe : ils ne verront que leurs fiches et le pool.`;
    case 'own_settings_lost':
      return 'Vous ne pouvez pas retirer « Paramètres » à votre propre rôle.';
  }
}
