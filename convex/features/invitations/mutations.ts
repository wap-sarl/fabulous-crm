import { v } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { internal } from '../../_generated/api';
import { adminMutation } from '../../_lib/auth';
import {
  appOrigin,
  isEmailWhitelisted,
  isEmailProviderConfigured,
  logAudit,
  resolveEmailProvider,
} from '../../lib';
import { INVITE_EMAIL, LOGIN_ACCENT, generateEmailHtml } from '../../auth/emailTemplates';
import { invitationRoleValidator } from '../../_lib/validators/invitations';

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Send the "you're invited" email through the active provider. There is no
 * token: the CTA points at the app sign-in page and the recipient activates
 * their access by signing in with this (allowlisted) email. Best-effort — the
 * dev whitelist gate mirrors sendSignInOtp so we never email real people in dev.
 */
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

/**
 * Invite a new member (admin only). The invited email may then sign in via any
 * Better Auth method; the gate + `triggers.user.onCreate` provision their
 * employee row with this role on first login.
 */
export const createInvitation = adminMutation({
  args: { email: v.string(), role: invitationRoleValidator },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!emailRe.test(email)) throw new Error('invalid_email');

    const existing = await ctx.db
      .query('users')
      .withIndex('by_email_type', (q) =>
        q.eq('email', email).eq('type', 'employee').eq('deletedAt', undefined)
      )
      .first();
    if (existing) throw new Error('already_member');

    const pending = await ctx.db
      .query('invitations')
      .withIndex('by_email_status', (q) => q.eq('email', email).eq('status', 'pending'))
      .first();
    if (pending) throw new Error('already_invited');

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

    // Best-effort invite email — the invitation still works via the allowlist
    // even if no email provider is configured.
    await scheduleInviteEmail(ctx, email);

    return invitationId;
  },
});

/**
 * Re-send the invite email for a still-pending invitation (admin only). Unlike
 * createInvitation this requires a configured email provider — its whole purpose
 * is the email — so it throws `email_not_configured` when none is set.
 */
export const resendInvitation = adminMutation({
  args: { invitationId: v.id('invitations') },
  handler: async (ctx, args) => {
    const invite = await ctx.db.get(args.invitationId);
    if (!invite) throw new Error('invitation_not_found');
    if (invite.status !== 'pending') throw new Error('invitation_not_pending');

    const cfg = await ctx.db.query('appConfig').first();
    if (!isEmailProviderConfigured(resolveEmailProvider(cfg))) {
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
export const revokeInvitation = adminMutation({
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
