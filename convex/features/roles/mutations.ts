import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { settingsMutation } from '../../_lib/auth';
import { accessWarnings, roleAccessValidator } from '../../_lib/validators/access';
import {
  ADMIN_ROLE_KEY,
  BUILT_IN_ROLE_KEYS,
  MAX_ROLE_LABEL_LENGTH,
  ROLE_KEY_RE,
  roleKeyOf,
} from '../../_lib/validators/roles';
import { computeChanges, isNotDeleted, logAudit, updateAuditFields } from '../../lib';
import { ensureDefaultRoles, findRole } from '../../lib/roles';

function cleanLabel(raw: string): string {
  const label = raw.trim();
  if (!label) throw new Error('role_label_required');
  if (label.length > MAX_ROLE_LABEL_LENGTH) throw new Error('role_label_too_long');
  return label;
}

/** Live employees and pending invitations holding a role key. */
async function usersOfRole(ctx: MutationCtx, key: string) {
  const users = (
    await ctx.db
      .query('users')
      .withIndex('by_type', (q) => q.eq('type', 'employee'))
      .collect()
  ).filter((u) => isNotDeleted(u) && (u.role ?? 'member') === key);
  const invitations = (await ctx.db.query('invitations').collect()).filter(
    (i) => i.status === 'pending' && i.role === key,
  );
  return { users, invitations };
}

/** The lock-out guard: the caller's own role must keep the settings switch. */
function assertNoLockOut(ctx: { visibility: { role: { key: string } } }, role: Doc<'roles'>) {
  const warnings = accessWarnings([role], { callerRoleKey: ctx.visibility.role.key });
  if (warnings.some((w) => w.code === 'own_settings_lost')) throw new Error('role_lock_out');
}

/** Seed the built-in roles (setup wizard, first visit of the settings screen). */
export const ensureDefaults = settingsMutation({
  args: {},
  handler: async (ctx) => {
    await ensureDefaultRoles(ctx, ctx.userId);
  },
});

/** A custom role, starting from the cells of an existing role. */
export const createRole = settingsMutation({
  args: { label: v.string(), access: roleAccessValidator },
  handler: async (ctx, args) => {
    const label = cleanLabel(args.label);
    let key = roleKeyOf(label);
    if (!ROLE_KEY_RE.test(key)) throw new Error('role_label_invalid');
    // Keys are stable and unique: suffix a clash (« Support » twice → support_2).
    const base = key;
    for (let n = 2; await findRole(ctx, key); n++) key = `${base}_${n}`.slice(0, 32);
    const roleId = await ctx.db.insert('roles', {
      key,
      label,
      access: args.access,
      builtIn: false,
      updatedAt: Date.now(),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'role',
      entityId: roleId,
      action: 'create',
    });
    return key;
  },
});

/** Rename a role and/or edit its cells. `admin` keeps full access whatever is sent. */
export const updateRole = settingsMutation({
  args: {
    key: v.string(),
    label: v.optional(v.string()),
    access: v.optional(roleAccessValidator),
  },
  handler: async (ctx, args) => {
    await ensureDefaultRoles(ctx, ctx.userId);
    const role = await findRole(ctx, args.key);
    if (!role) throw new Error('role_not_found');
    const updates: { label?: string; access?: Doc<'roles'>['access'] } = {};
    if (args.label !== undefined) updates.label = cleanLabel(args.label);
    if (args.access !== undefined) {
      if (role.key === ADMIN_ROLE_KEY) throw new Error('role_admin_locked');
      updates.access = args.access;
      assertNoLockOut(ctx, { ...role, access: args.access });
    }
    const changes = computeChanges(role, updates);
    if (!changes) return;
    await ctx.db.patch(role._id, { ...updates, ...updateAuditFields(ctx.userId) });
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'role',
      entityId: role._id,
      action: 'update',
      metadata: { key: role.key, changes },
    });
  },
});

/**
 * Delete a custom role. When users or pending invitations still hold it, a
 * replacement role is required and they are moved (each user audited).
 */
export const deleteRole = settingsMutation({
  args: { key: v.string(), replacementKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const role = await findRole(ctx, args.key);
    if (!role) throw new Error('role_not_found');
    if (role.builtIn || (BUILT_IN_ROLE_KEYS as readonly string[]).includes(role.key)) {
      throw new Error('role_built_in');
    }
    const { users, invitations } = await usersOfRole(ctx, role.key);
    if (users.length > 0 || invitations.length > 0) {
      if (!args.replacementKey || args.replacementKey === role.key) {
        throw new Error('role_in_use');
      }
      const replacement = await findRole(ctx, args.replacementKey);
      if (!replacement) throw new Error('role_not_found');
      for (const user of users) {
        await ctx.db.patch(user._id, { role: replacement.key, ...updateAuditFields(ctx.userId) });
        await logAudit({
          ctx,
          userId: ctx.userId,
          entityType: 'employee',
          entityId: user._id,
          action: 'update',
          metadata: { changes: { role: { old: role.key, new: replacement.key } } },
        });
      }
      for (const invitation of invitations) {
        await ctx.db.patch(invitation._id, { role: replacement.key });
      }
    }
    await ctx.db.delete(role._id);
    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'role',
      entityId: role._id,
      action: 'delete',
      metadata: { key: role.key, replacementKey: args.replacementKey ?? null },
    });
  },
});
