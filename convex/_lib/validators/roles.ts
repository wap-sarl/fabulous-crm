import { type Infer, v } from 'convex/values';
import { type RoleAccess, roleAccessValidator, uniformAccess } from './access';
import { logsValidator } from './shared';

export const roleValidator = v.object({
  ...logsValidator.fields,
  key: v.string(),
  label: v.string(),
  access: roleAccessValidator,
  builtIn: v.boolean(),
});

export type Role = Infer<typeof roleValidator>;

export const ADMIN_ROLE_KEY = 'admin';
export const DEFAULT_ROLE_KEY = 'member';
export const BUILT_IN_ROLE_KEYS = ['admin', 'manager', 'member'] as const;
export const ROLE_KEY_RE = /^[a-z0-9_]{1,32}$/;
export const MAX_ROLE_LABEL_LENGTH = 40;

/** The agreed ladder: admin everything, manager their team, member their own records. */
export const DEFAULT_ROLES: { key: string; label: string; access: RoleAccess }[] = [
  { key: 'admin', label: 'Administrateur', access: uniformAccess('all', true) },
  { key: 'manager', label: 'Manager', access: uniformAccess('team', false) },
  { key: 'member', label: 'Membre', access: uniformAccess('own', false) },
];

export const ADMIN_ACCESS: RoleAccess = uniformAccess('all', true);

/** Defaults for a key, or `member`'s for an unknown one — so a missing row never locks anyone out. */
export function defaultRoleAccess(key: string): RoleAccess {
  return (DEFAULT_ROLES.find((r) => r.key === key) ?? DEFAULT_ROLES[2]).access;
}

/** Accent-free lowercase slug for a new role key. */
export function roleKeyOf(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}
