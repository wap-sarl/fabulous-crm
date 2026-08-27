import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal';
import { emailOTP, genericOAuth } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { convex, crossDomain } from '@convex-dev/better-auth/plugins';
import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { isActionCtx } from '@convex-dev/better-auth/utils';
import { makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import authConfig from './auth.config';
import { enforceRateLimit } from './lib/rateLimits';
import { SOCIAL_PROVIDERS } from './_lib/socialProviders';
import type { SsoProvider } from './_lib/validators/appConfig';
import { appOrigin, appOrigins, isEmailWhitelisted, logAudit, serializeUser } from './lib';
import { LOGIN_ACCENT, LOGIN_EMAIL, generateEmailHtml } from './auth/emailTemplates';
import { internalQuery, query } from './_generated/server';
import { resolveRoleAccess } from './lib/roles';

/**
 * Better Auth is the single session authority for this app (social OAuth +
 * passwordless email, mirroring the sibling `ductus` project). There is no
 * hand-rolled session token: server code reads the current user via
 * `authComponent.safeGetAuthUser(ctx)` and the app's `users` (employee) row is
 * linked to the Better Auth user through `users.authId`.
 *
 * The ONLY custom logic layered on top of the vanilla Better Auth setup is the
 * invite-only membership model:
 *  - `databaseHooks.user.create.before` (the GATE) rejects any email that is not
 *    already an employee and has no pending invitation.
 *  - the `triggers.user.onCreate` callback (PROVISION + LINK) creates the
 *    employee row from the invitation on first login, links `authId`, and retires
 *    the invitation.
 *  - the `triggers.session.onCreate` callback (RE-LINK) runs the same link step on
 *    every sign-in. `user.onCreate` fires exactly once — at Better Auth user
 *    creation — so if the employee row is created *after* the Better Auth user
 *    already exists (e.g. the setup wizard provisions the owner after a first
 *    Google login), it would never get linked and `getCurrentUser` would return
 *    null forever. Reconciling on session creation self-heals that ordering.
 */

const OTP_LENGTH = 6;
const OTP_MAX_AGE_SECONDS = 20 * 60;

/**
 * Provision-or-link the app employee for a freshly created Better Auth user.
 * Runs in an app mutation ctx (via the component `triggers`), exactly once, when
 * the Better Auth user row is created. The GATE (below) has already guaranteed
 * the email is either an existing employee or a pending invitation.
 */
async function linkOrProvisionEmployee(
  ctx: MutationCtx,
  authUser: { _id: string; email?: string; name?: string },
): Promise<void> {
  const email = (authUser.email ?? '').trim().toLowerCase();
  if (!email) return;

  // Existing active employee (e.g. the wizard-provisioned owner, or someone who
  // already signed in via another provider) → just link the auth id.
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

/**
 * Better Auth Convex client. `triggers.user.onCreate` links/provisions the app
 * employee; `authFunctions.onCreate` points at the generated trigger dispatcher
 * (`triggersApi().onCreate`, exported below).
 */
export const authComponent = createClient<DataModel>(components.betterAuth, {
  triggers: {
    user: {
      onCreate: linkOrProvisionEmployee,
    },
    session: {
      // Re-link on every sign-in (see the header comment). Fetch the Better Auth
      // user straight off the component adapter — mirroring `getAnyUserById` — so
      // we don't reference `authComponent` inside its own initializer (TS7022).
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
    // Referenced by name (not `internal.auth.onCreate`) to break a type cycle:
    // `onCreate` is exported just below from `authComponent.triggersApi()`, so a
    // typed `internal.auth.onCreate` reference here would make `authComponent`'s
    // inferred type depend on its own initializer (TS7022).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onCreate: makeFunctionReference<'mutation'>('auth:onCreate') as any,
  },
});

export const { onCreate } = authComponent.triggersApi();

/**
 * DB-backed social providers — every well-known provider is registered
 * unconditionally as an async resolver so its callback route
 * (`/api/auth/callback/<key>`) is always mounted; credentials are read from the
 * singleton `appConfig` at request time. The closure MUST tolerate a non-action
 * ctx (schema gen / CORS origin resolution): those paths can't `runQuery`, so it
 * returns disabled instead of throwing.
 */
function buildSocialProviders(ctx: GenericCtx<DataModel>): BetterAuthOptions['socialProviders'] {
  const providers: BetterAuthOptions['socialProviders'] = {};
  for (const p of SOCIAL_PROVIDERS) {
    providers[p.key] = async () => {
      if (!isActionCtx(ctx)) {
        return { clientId: '', clientSecret: '', enabled: false };
      }
      const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
      const sp = cfg?.auth.socialProviders?.find((s) => s.id === p.key);
      return {
        clientId: sp?.clientId ?? '',
        clientSecret: sp?.clientSecret ?? '',
        enabled: !!sp?.enabled && !!sp.clientId && !!sp.clientSecret,
      };
    };
  }
  return providers;
}

/**
 * Send a passwordless sign-in email through Brevo. Runs inside the Better Auth
 * request handler (an action ctx), so it can read the runtime `appConfig` for
 * the magic-link toggle + sender overrides. The 6-digit OTP rides in the link's
 * query string (`?otp=`) so clicking it lands on `/auth/continue` and signs in.
 */
async function sendSignInOtp(
  ctx: GenericCtx<DataModel>,
  { email, otp }: { email: string; otp: string },
): Promise<void> {
  // Sending needs an action ctx: to read the config and to run the node email
  // action (SMTP uses nodemailer, which can't be imported here). Non-action ctx
  // (schema gen etc.) never actually sends a sign-in email.
  if (!isActionCtx(ctx)) return;

  if (!(await enforceRateLimit(ctx, 'otpEmail', email))) {
    throw new Error('Trop de demandes de code. Réessayez dans quelques minutes.');
  }

  const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
  if (cfg && cfg.auth.magicLinkEnabled === false) return; // method disabled by admin

  const appUrl = (cfg?.appUrl || appOrigin()).replace(/\/+$/, '');
  const params = new URLSearchParams({ email, otp });
  const confirmUrl = `${appUrl}/auth/continue?${params.toString()}`;

  if (!isEmailWhitelisted(email, process.env.DEV_WHITELIST_EMAILS)) {
    console.warn(`[DEV WHITELIST] Sign-in email blocked: ${email}`);
    return;
  }

  // Dispatch through the active email provider (Brevo API or SMTP). The sender
  // identity is resolved from appConfig inside the action (resolveEmailProvider).
  await ctx.runAction(internal.features.email.actions.sendProviderEmail, {
    to: email,
    subject: LOGIN_EMAIL.subject,
    htmlContent: generateEmailHtml(confirmUrl, LOGIN_EMAIL, LOGIN_ACCENT),
  });
}

/**
 * The `genericOAuth` block for custom OIDC/SSO issuers, built from the DB config
 * (`appConfig.auth.ssoProviders`). Unlike social providers, `genericOAuth` reads
 * `clientId`/`clientSecret` synchronously off a static array — it has no async
 * resolver hook — so the providers are resolved from the DB just before the
 * request handler runs (see `createAuth`) and passed in here. Absent when empty.
 */
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

/**
 * Plugins: passwordless email (`emailOTP`), cross-domain session transport (the
 * SPA lives on a different origin than `*.convex.site`, so the session travels
 * as a Bearer token, not a cookie), the required `convex` plugin, and the
 * DB-driven `genericOAuth` block for custom OIDC/SSO issuers (`ssoProviders`).
 */
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

/**
 * Shared Better Auth options. `ssoProviders` is the only DB-driven input; every
 * other field is static or resolved by per-request closures (social credentials,
 * email delivery, the gate). Factored so the base instance and the per-request
 * SSO rebuild (see `createAuth`) can never drift.
 */
function authOptions(ctx: GenericCtx<DataModel>, ssoProviders: SsoProvider[]) {
  return {
    // The Convex HTTP-actions origin (where /api/auth is served). Better Auth
    // derives every OAuth callback from this (`${baseURL}/api/auth/callback/*`).
    baseURL: process.env.CONVEX_SITE_URL,
    database: authComponent.adapter(ctx),
    // Static (env, not DB): the component resolves trustedOrigins from an empty
    // ctx when building the CORS layer. `SITE_URL` (comma-separated) with a
    // `CRM_APP_URL` fallback — see appOrigins().
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
    // THE GATE: only invited or already-registered emails may create an account.
    // Applies to every provider — social, SSO, and email OTP alike.
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

/**
 * The Better Auth factory. MUST stay synchronous and tolerate an empty ctx
 * (`createAuth({})`), which the component uses for schema/route/CORS generation.
 * Credentials + email delivery are resolved lazily inside per-request closures.
 *
 * Custom SSO issuers are the one exception: `genericOAuth` reads its credentials
 * synchronously off a static array (no async resolver hook like social providers
 * have), so they can't be resolved inside `betterAuth(...)` here. Instead, for a
 * real request we return a Proxy that overrides only `.handler` — the ONLY member
 * the Convex adapter consumes per request (`@convex-dev/better-auth`
 * create-client.js: `await createAuth(ctx).handler(request)`). The override
 * prefetches the DB SSO providers, then builds and delegates to a betterAuth
 * instance that includes them. Requests reach the handler via a catch-all
 * `/api/auth/` route, so the SSO callback route need not exist on the static
 * instance; and `genericOAuth` contributes no DB schema, so its absence from the
 * empty-ctx path is harmless.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const base = betterAuth(authOptions(ctx, []));
  if (!isActionCtx(ctx)) return base;
  return new Proxy(base, {
    get(target, prop) {
      if (prop !== 'handler') return Reflect.get(target, prop);
      return async (request: Request): Promise<Response> => {
        const cfg = await ctx.runQuery(internal.features.config.internal.getConfig);
        const sso = (cfg?.auth.ssoProviders ?? []).filter(
          (p) => p.enabled && p.clientId && p.clientSecret,
        );
        if (sso.length === 0) return target.handler(request);
        return betterAuth(authOptions(ctx, sso)).handler(request);
      };
    },
  });
};

/**
 * The current app employee (serialized) for the signed-in Better Auth user, or
 * `null` when signed out / not yet linked. This is the frontend's auth source.
 */
export const getCurrentUser = query({
  args: {},
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

/**
 * The app employee linked to a Better Auth user id, or `null`. Internal-only:
 * used by `employeeAction` to authorize actions. Actions can't touch the DB, and
 * the `sessionId` claim `safeGetAuthUser` needs is not reliably preserved when a
 * query is re-entered via `runQuery` from an action — so the action reads the
 * identity on its own ctx and passes the resolved `authId` here explicitly.
 */
export const getEmployeeByAuthId = internalQuery({
  args: { authId: v.string() },
  handler: async (ctx, { authId }) => {
    const employee = await ctx.db
      .query('users')
      .withIndex('by_authId', (q) => q.eq('authId', authId))
      .first();
    if (!employee || employee.deletedAt) return null;
    return employee;
  },
});
