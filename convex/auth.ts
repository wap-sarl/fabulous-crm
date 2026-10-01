import { docOf } from './lib/shared/docs';
import { roleAccessValidator } from './_lib/validators/access';
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import { emailOTP, genericOAuth } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { isActionCtx } from '@convex-dev/better-auth/utils';
import { makeFunctionReference } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import authConfig from './auth.config';
import { enforceRateLimit } from './lib/security/rateLimits';
import { SOCIAL_PROVIDERS } from './_lib/socialProviders';
import { decryptSecret } from './lib/security/crypto';
import type { SsoProvider } from './_lib/validators/appConfig';
import { appOrigin, appOrigins } from './lib/config/appUrl';
import { isEmailWhitelisted } from './lib/shared/devWhitelist';
import { logAudit } from './lib/audit/log';
import { serializeUser } from './lib/users/serialize';
import { LOGIN_ACCENT, LOGIN_EMAIL, generateEmailHtml } from './auth/emailTemplates';
import { internalAction, internalMutation, internalQuery, query } from './_generated/server';
import { resolveRoleAccess } from './lib/roles/access';
import { gateInvitation, gateSignInCode } from './lib/extensions/gates';
import { traceHookFailure } from './lib/extensions/observers';
import { countPendingInvitations } from './lib/invitations/pending';

/** Better Auth is the only session authority; the one custom layer is invite-only membership: a gate on user creation, then the employee row linked through `users.authId`. */

const OTP_LENGTH = 6;
const OTP_MAX_AGE_SECONDS = 20 * 60;

/** Links the employee to the Better Auth user, or provisions it from the invitation: the gate has already let only employees and invited emails through. */
async function linkOrProvisionEmployee(
  ctx: MutationCtx,
  authUser: { _id: string; email?: string; name?: string },
): Promise<void> {
  const email = (authUser.email ?? '').trim().toLowerCase();
  if (!email) return;

  // An employee that already exists (the owner made by the wizard, a sign-in through another provider) is only linked.
  const existing = await ctx.db
    .query('users')
    .withIndex('by_email_type', (q) =>
      q.eq('email', email).eq('type', 'employee').eq('deletedAt', undefined),
    )
    .first();
  if (existing) {
    if (existing.authId !== authUser._id) {
      await ctx.db.patch(existing._id, { authId: authUser._id, updatedAt: Date.now() });
    }
    return;
  }

  // Otherwise provision from the pending invitation.
  const invite = await ctx.db
    .query('invitations')
    .withIndex('by_email_status', (q) => q.eq('email', email).eq('status', 'pending'))
    .first();
  if (!invite) return; // Gate should have prevented this; stay defensive.
  await gateInvitation(ctx, 'accept', await countPendingInvitations(ctx));

  const now = Date.now();
  const nameParts = (authUser.name ?? '').trim().split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? email.split('@')[0];
  const lastName = nameParts.slice(1).join(' ');

  const userId = await ctx.db.insert('users', {
    type: 'employee',
    role: invite.role,
    email,
    firstName,
    lastName,
    birthDate: '1970-01-01',
    jobTitle: 'CRM',
    phone: '',
    address: { street: '', streetNumber: '', postalCode: '', city: '', country: 'FR' },
    authId: authUser._id,
    updatedAt: now,
  });

  // Retire the invitation (keep the row for the audit trail).
  await ctx.db.patch(invite._id, { status: 'accepted', acceptedAt: now });

  await logAudit({
    ctx,
    userId,
    entityType: 'invitation',
    entityId: invite._id,
    action: 'update',
    metadata: { email, role: invite.role, event: 'accepted' },
  });
}

/** `authFunctions.onCreate` must point at the trigger dispatcher exported below (`triggersApi().onCreate`). */
export const authComponent = createClient<DataModel>(components.betterAuth, {
  triggers: {
    user: {
      onCreate: linkOrProvisionEmployee,
    },
    session: {
      // `user.onCreate` fires once, so an employee row made after the Better Auth user is linked here; the adapter is read directly, `authComponent` cannot appear in its own initializer (TS7022).
      onCreate: async (ctx, session: { userId: string }): Promise<void> => {
        const authUser = await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: 'user',
          where: [{ field: '_id', value: session.userId }],
        });
        if (authUser) {
          await linkOrProvisionEmployee(
            ctx,
            authUser as { _id: string; email?: string; name?: string },
          );
        }
      },
    },
  },
  authFunctions: {
    // biome-ignore lint/suspicious/noExplicitAny: referenced by name, a typed `internal.auth.onCreate` would make authComponent's type depend on itself (TS7022)
    onCreate: makeFunctionReference<'mutation'>('auth:onCreate') as any,
  },
});

export const { onCreate } = authComponent.triggersApi();

/** Every provider is registered so its callback route is always mounted; credentials are read per request, and a non-action ctx (schema gen, CORS) gets a disabled provider, not a throw. */
function buildSocialProviders(ctx: GenericCtx<DataModel>): BetterAuthOptions['socialProviders'] {
  const providers: BetterAuthOptions['socialProviders'] = {};
  for (const p of SOCIAL_PROVIDERS) {
    providers[p.key] = async () => {
      if (!isActionCtx(ctx)) {
        return { clientId: '', clientSecret: '', enabled: false };
      }
      const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
      const sp = cfg?.auth.socialProviders?.find((s) => s.id === p.key);
      // Stored ciphertext; the clear value exists only here, for the token exchange.
      const clientSecret = sp?.clientSecret ? await decryptSecret(sp.clientSecret) : '';
      return {
        clientId: sp?.clientId ?? '',
        clientSecret,
        enabled: !!sp?.enabled && !!sp.clientId && !!clientSecret,
      };
    };
  }
  return providers;
}

export const SIGN_IN_HOOK_FAILURE_ENTITY_ID = 'extensions:beforeSignInCode';

/** What the hook's throw means: a `ConvexError` is a refusal (its code, when it looks like one); anything else is an overlay bug. */
function readSignInCodeThrow(
  error: unknown,
  email: string,
): { refusal: string } | { failure: string } {
  if (error instanceof ConvexError) {
    const code = (error.data as { code?: unknown } | null)?.code;
    return {
      refusal: typeof code === 'string' && /^[a-z0-9_.:-]{1,64}$/i.test(code) ? code : 'unknown',
    };
  }
  // The operator needs the message to fix the overlay; the address, should it be quoted there, is taken out.
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { failure: text.replaceAll(email, '<address>').slice(0, 200) };
}

/** A broken sign-in hook stops every code: besides the error log, one audit row an hour says so where an admin looks. */
export const traceSignInHookFailure = internalMutation({
  args: { failure: v.string() },
  returns: v.null(),
  handler: async (ctx, { failure }) => {
    await traceHookFailure(ctx, SIGN_IN_HOOK_FAILURE_ENTITY_ID, {
      event: 'beforeSignInCode_failed',
      failure,
    });
    return null;
  },
});

/** Delivery goes to the scheduler: Better Auth awaits this (1.6.15, no `backgroundTasks` handler), so a decision made here per address would show in the response time. */
async function sendSignInOtp(
  ctx: GenericCtx<DataModel>,
  { email, otp }: { email: string; otp: string },
): Promise<void> {
  // Non-action ctx (schema gen etc.) never sends a sign-in email.
  if (!isActionCtx(ctx)) return;
  await ctx.scheduler.runAfter(0, internal.auth.deliverSignInCode, { email, otp });
}

/** The code rides in the link (`?otp=`) so a click on it signs in; every refusal is silent, the requester got the same answer at the same speed either way. */
export const deliverSignInCode = internalAction({
  args: { email: v.string(), otp: v.string() },
  returns: v.null(),
  handler: async (ctx, { email, otp }) => {
    if (!(await enforceRateLimit(ctx, 'otpEmail', email))) return null;

    const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
    if (cfg && cfg.auth.magicLinkEnabled === false) return null; // method disabled by admin

    // Extension seam. Silence for the requester either way; the operator must tell a refusal from a broken overlay.
    try {
      await gateSignInCode(ctx, { email, type: 'sign-in' });
    } catch (error) {
      const thrown = readSignInCodeThrow(error, email);
      if ('refusal' in thrown) {
        console.warn(`[sign-in] code not sent, refused by the extension seam: ${thrown.refusal}`);
        return null;
      }
      console.error(
        `[sign-in] seam bug, code not sent (nobody can sign in by code): ${thrown.failure}`,
      );
      await ctx.runMutation(internal.auth.traceSignInHookFailure, { failure: thrown.failure });
      return null;
    }

    if (!isEmailWhitelisted(email, process.env.DEV_WHITELIST_EMAILS)) {
      console.warn(`[DEV WHITELIST] Sign-in email blocked: ${email}`);
      return null;
    }

    const appUrl = (cfg?.appUrl || appOrigin()).replace(/\/+$/, '');
    const params = new URLSearchParams({ email, otp });
    // Dispatch through the active email provider (Brevo API or SMTP); the sender is resolved inside the action.
    await ctx.runAction(internal.features.email.actions.sendProviderEmail, {
      to: email,
      subject: LOGIN_EMAIL.subject,
      htmlContent: generateEmailHtml(
        `${appUrl}/auth/continue?${params.toString()}`,
        LOGIN_EMAIL,
        LOGIN_ACCENT,
      ),
    });
    return null;
  },
});

/** `genericOAuth` reads its credentials synchronously off a static array, so the SSO providers are resolved before the request handler runs (see `createAuth`) and passed in. */
function buildSsoPlugin(providers: SsoProvider[]) {
  if (providers.length === 0) return [];
  return [
    genericOAuth({
      config: providers.map((p) => ({
        providerId: p.providerId,
        clientId: p.clientId,
        clientSecret: p.clientSecret,
        discoveryUrl: `${p.issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`,
        scopes: p.scopes.length > 0 ? p.scopes : ['openid', 'email', 'profile'],
        pkce: true,
      })),
    }),
  ];
}

/** `crossDomain` is needed because the SPA is on another origin than `*.convex.site`: the session travels as a Bearer token, not a cookie. */
function buildPlugins(ctx: GenericCtx<DataModel>, ssoProviders: SsoProvider[]) {
  return [
    emailOTP({
      otpLength: OTP_LENGTH,
      expiresIn: OTP_MAX_AGE_SECONDS,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'sign-in') return;
        await sendSignInOtp(ctx, { email: email.trim().toLowerCase(), otp });
      },
    }),
    ...buildSsoPlugin(ssoProviders),
    crossDomain({ siteUrl: appOrigin() }),
    convex({ authConfig }),
  ];
}

/** One set of options for the base instance and the per-request SSO rebuild (see `createAuth`), so the two can never drift. */
function authOptions(ctx: GenericCtx<DataModel>, ssoProviders: SsoProvider[]) {
  return {
    // Better Auth derives every OAuth callback from the origin that serves /api/auth.
    baseURL: process.env.CONVEX_SITE_URL,
    database: authComponent.adapter(ctx),
    // From the environment, not the database: the component resolves the origins from an empty ctx to build the CORS layer.
    trustedOrigins: appOrigins(),
    rateLimit: {
      enabled: true,
      storage: 'database' as const,
      window: 60,
      max: 30,
      customRules: {
        '/email-otp/send-verification-otp': { window: 60, max: 5 },
        '/sign-in/email-otp': { window: 60, max: 10 },
      },
    },
    socialProviders: buildSocialProviders(ctx),
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: SOCIAL_PROVIDERS.map((p) => p.key),
      },
    },
    // The gate: only an invited or already registered email may create an account, whatever the provider (social, SSO, email code).
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email?: string }) => {
            // Non-request paths (schema gen, CORS) can't runQuery — don't gate.
            if (!isActionCtx(ctx)) return;
            const email = (user.email ?? '').trim().toLowerCase();
            if (!email) throw new APIError('BAD_REQUEST', { message: 'email_required' });
            const allowed = await ctx.runQuery(internal.features.invitations.internal.isAllowed, {
              email,
            });
            if (!allowed) throw new APIError('FORBIDDEN', { message: 'not_invited' });
          },
        },
      },
    },
    plugins: buildPlugins(ctx, ssoProviders),
  };
}

/** Must stay synchronous and accept an empty ctx (schema, routes, CORS); SSO needs the database, so a Proxy overrides `.handler`, the only member the Convex adapter calls per request. */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const base = betterAuth(authOptions(ctx, []));
  if (!isActionCtx(ctx)) return base;
  return new Proxy(base, {
    get(target, prop) {
      if (prop !== 'handler') return Reflect.get(target, prop);
      return async (request: Request): Promise<Response> => {
        const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
        const sso = await Promise.all(
          (cfg?.auth.ssoProviders ?? [])
            .filter((p) => p.enabled && p.clientId && p.clientSecret)
            .map(async (p) => ({ ...p, clientSecret: await decryptSecret(p.clientSecret) })),
        );
        if (sso.length === 0) return target.handler(request);
        return betterAuth(authOptions(ctx, sso)).handler(request);
      };
    },
  });
};

/** The frontend's auth source: `null` when signed out or when the employee is not linked yet. */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.string(),
      email: v.string(),
      type: v.literal('employee'),
      role: v.string(),
      roleLabel: v.string(),
      access: roleAccessValidator,
      name: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const authUser = await authComponent.safeGetAuthUser(ctx);
    if (!authUser) return null;
    const employee = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', authUser._id))
      .first();
    if (!employee || employee.deletedAt) return null;
    return serializeUser(employee, await resolveRoleAccess(ctx, employee.role));
  },
});

/** Takes the `authId` explicitly: the `sessionId` claim `safeGetAuthUser` needs is not reliably kept when an action re-enters a query through `runQuery`. */
export const getEmployeeByAuthId = internalQuery({
  args: { authId: v.string() },
  returns: v.union(docOf('users'), v.null()),
  handler: async (ctx, { authId }) => {
    const employee = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', authId))
      .first();
    if (!employee || employee.deletedAt) return null;
    return employee;
  },
});
