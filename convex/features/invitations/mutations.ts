import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { settingsMutation } from '../../_lib/auth';
import { appOrigin } from '../../lib/config/appUrl';
import { isEmailWhitelisted } from '../../lib/shared/devWhitelist';
import { isEmailProviderConfigured, resolveEmailProvider } from '../../lib/email/provider';
import { logAudit } from '../../lib/audit/log';
import { INVITE_EMAIL, LOGIN_ACCENT, generateEmailHtml } from '../../auth/emailTemplates';
import { invitationRoleValidator } from '../../_lib/validators/invitations';
import { DEFAULT_ROLES } from '../../_lib/validators/roles';
import { gateInvitation } from '../../lib/extensions/gates';
import { countPendingInvitations } from '../../lib/invitations/pending';
import { findRole } from '../../lib/roles/access';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The invite carries no token: the recipient signs in with the allowlisted email; the dev whitelist keeps real people from being emailed in dev. */
async function scheduleInviteEmail(ctx: MutationCtx, email: string) {
  if (!isEmailWhitelisted(email, process.env.DEV_WHITELIST_EMAILS)) return;
  const cfg = await ctx.db.query('appConfig').first();
  const appUrl = (cfg?.appUrl || appOrigin()).replace(/\/+$/, '');
  await ctx.scheduler.runAfter(0, internal.features.email.actions.sendProviderEmail, {
    to: email,
    subject: INVITE_EMAIL.subject,
    htmlContent: generateEmailHtml(appUrl, INVITE_EMAIL, LOGIN_ACCENT),
  });
}

/** The invited email may sign in by any Better Auth method: the employee row is provisioned with this role on first login. */
export const createInvitation = settingsMutation({
  args: { email: v.string(), role: invitationRoleValidator },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!emailRe.test(email)) throw new Error('invalid_email');
    if (!(await findRole(ctx, args.role)) && !DEFAULT_ROLES.some((r) => r.key === args.role)) {
      throw new Error('invalid_role');
    }

    const existing = await ctx.db
      .query('users')
      .withIndex('by_email_type', (q) =>
        q.eq('email', email).eq('type', 'employee').eq('deletedAt', undefined),
      )
      .first();
    if (existing) throw new Error('already_member');

    const pending = await ctx.db
      .query('invitations')
      .withIndex('by_email_status', (q) => q.eq('email', email).eq('status', 'pending'))
      .first();
    if (pending) throw new Error('already_invited');
    await gateInvitation(ctx, 'create', await countPendingInvitations(ctx));

    const now = Date.now();
    const invitationId = await ctx.db.insert('invitations', {
      email,
      role: args.role,
      status: 'pending',
      invitedBy: ctx.userId,
      invitedAt: now,
    });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'invitation',
      entityId: invitationId,
      action: 'create',
      metadata: { email, role: args.role },
    });

    // Best effort: the invitation still works through the allowlist when no email provider is configured.
    await scheduleInviteEmail(ctx, email);

    return invitationId;
  },
});

/** Unlike createInvitation this requires a configured email provider: the email is its whole purpose. */
export const resendInvitation = settingsMutation({
  args: { invitationId: v.id('invitations') },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new Error('invitation_not_found');
    if (invite.status !== 'pending') throw new Error('invitation_not_pending');

    const cfg = await ctx.db.query('appConfig').first();
    if (!isEmailProviderConfigured(await resolveEmailProvider(cfg))) {
      throw new Error('email_not_configured');
    }

    await ctx.db.patch(args.invitationId, { invitedAt: Date.now() });
    await scheduleInviteEmail(ctx, invite.email);

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'invitation',
      entityId: args.invitationId,
      action: 'update',
      metadata: { email: invite.email, event: 'resent' },
    });
  },
});

/** Revoke a still-pending invitation (admin only). */
export const revokeInvitation = settingsMutation({
  args: { invitationId: v.id('invitations') },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new Error('invitation_not_found');
    if (invite.status !== 'pending') throw new Error('invitation_not_pending');

    await ctx.db.patch(args.invitationId, { status: 'revoked' });

    await logAudit({
      ctx,
      userId: ctx.userId,
      entityType: 'invitation',
      entityId: args.invitationId,
      action: 'update',
      metadata: { email: invite.email, event: 'revoked' },
    });
  },
});
