import type { useRoles } from '../../lib/hooks/useRoles';

export type RoleRow = ReturnType<typeof useRoles>['roles'][number];
