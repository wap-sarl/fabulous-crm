import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { RoleAccess } from '../_lib/validators/access';
import {
  ADMIN_ACCESS,
  ADMIN_ROLE_KEY,
  DEFAULT_ROLES,
  defaultRoleAccess,
} from '../_lib/validators/roles';

/** The stored role row, or null when the key has no row (defaults apply). */
export async function findRole(
  ctx: QueryCtx | MutationCtx,
  key: string,
): Promise<Doc<'roles'> | null> {
  return await ctx.db
    .query('roles')
    .withIndex('by_key', (q) => q.eq('key', key))
    .first();
}

/**
 * The access of a role key. `admin` is always full access whatever the row
 * says (the guaranteed way back in); an unknown key gets `member`'s defaults.
 */
export async function resolveRoleAccess(
  ctx: QueryCtx | MutationCtx,
  key: string | undefined,
): Promise<{ key: string; label: string; access: RoleAccess }> {
  const roleKey = key ?? 'member';
  if (roleKey === ADMIN_ROLE_KEY) {
    const row = await findRole(ctx, roleKey);
    return { key: roleKey, label: row?.label ?? 'Administrateur', access: ADMIN_ACCESS };
  }
  const row = await findRole(ctx, roleKey);
  if (row) return { key: row.key, label: row.label, access: row.access };
  const fallback = DEFAULT_ROLES.find((r) => r.key === roleKey);
  return {
    key: roleKey,
    label: fallback?.label ?? roleKey,
    access: defaultRoleAccess(roleKey),
  };
}

/** Insert the built-in roles that are missing; idempotent. */
export async function ensureDefaultRoles(ctx: MutationCtx, userId?: Id<'users'>): Promise<void> {
  for (const role of DEFAULT_ROLES) {
    if (await findRole(ctx, role.key)) continue;
    await ctx.db.insert('roles', {
      key: role.key,
      label: role.label,
      access: role.access,
      builtIn: true,
      updatedAt: Date.now(),
      createdBy: userId,
      updatedBy: userId,
    });
  }
}
