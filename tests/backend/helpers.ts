/**
 * Shared harness for convex-test integration tests running under `bun test`.
 * NOTE: this directory is a bun-test harness, NOT deployed Convex code — Node
 * builtins are fine here.
 *
 * convex-test is designed around Vite's `import.meta.glob` to enumerate the
 * function modules; bun has no equivalent, so `globModules` walks a directory
 * and builds the same `{ './relative/path': () => import(abs) }` map. The
 * exclusion mirrors convex-test's documented glob (`./**\/!(*.*.*)*.*s`): any
 * file with a second extension (`.test.ts`, `.d.ts`) is skipped.
 *
 * Auth: the app resolves the signed-in employee through the Better Auth
 * component (`authComponent.safeGetAuthUser` reads the identity's `sessionId`
 * claim, then looks up the session and user in the component's tables). Tests
 * therefore register the real component (schema + compiled modules from the
 * package dist) and seed it — no mocking, the production auth path runs as-is.
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { convexTest, type TestConvex } from 'convex-test';
import aggregateSchema from '../../node_modules/@convex-dev/aggregate/dist/component/schema.js';
import betterAuthSchema from '../../node_modules/@convex-dev/better-auth/dist/component/schema.js';
import rateLimiterSchema from '../../node_modules/@convex-dev/rate-limiter/dist/component/schema.js';
import { components } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { leadSearchText } from '../../convex/lib/leadSearch';
import schema from '../../convex/schema';

function globModules(
  root: string,
  skipDirs: string[] = [],
): Record<string, () => Promise<unknown>> {
  const modules: Record<string, () => Promise<unknown>> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.includes(entry.name)) walk(abs);
        continue;
      }
      // Same shape as convex-test's default glob: single-extension .ts/.js/.mts/.mjs.
      if (!/^[^.]+\.[mc]?[jt]s$/.test(entry.name)) continue;
      const rel = `./${relative(root, abs).replaceAll('\\', '/')}`;
      modules[rel] = () => import(abs);
    }
  };
  walk(root);
  return modules;
}

const appModules = globModules(join(import.meta.dir, '../../convex'));
const betterAuthDir = join(
  import.meta.dir,
  '../../node_modules/@convex-dev/better-auth/dist/component',
);
// testProfiles are the component's own test fixtures — not part of the runtime.
const betterAuthModules = globModules(betterAuthDir, ['testProfiles']);
const aggregateModules = globModules(
  join(import.meta.dir, '../../node_modules/@convex-dev/aggregate/dist/component'),
);
const rateLimiterModules = globModules(
  join(import.meta.dir, '../../node_modules/@convex-dev/rate-limiter/dist/component'),
);

export type T = TestConvex<typeof schema>;

/** Fresh test backend with the Better Auth and aggregate components registered. */
export function createTestConvex(): T {
  const t = convexTest(schema, appModules);
  t.registerComponent('betterAuth', betterAuthSchema, betterAuthModules);
  t.registerComponent('leadListMemberCounts', aggregateSchema, aggregateModules);
  t.registerComponent('leadsByStatus', aggregateSchema, aggregateModules);
  t.registerComponent('leadsByOwner', aggregateSchema, aggregateModules);
  t.registerComponent('leadsByLifecycle', aggregateSchema, aggregateModules);
  t.registerComponent('companiesTotal', aggregateSchema, aggregateModules);
  t.registerComponent('leadsByCompany', aggregateSchema, aggregateModules);
  t.registerComponent('dealsByStage', aggregateSchema, aggregateModules);
  t.registerComponent('dealsByPipelineStatus', aggregateSchema, aggregateModules);
  t.registerComponent('rateLimiter', rateLimiterSchema, rateLimiterModules);
  return t;
}

export type SeededEmployee = {
  userId: Id<'users'>;
  authId: string;
  /** Pass to `asIdentity` / `t.withIdentity` to act as this employee. */
  identity: { subject: string; sessionId: string };
};

/**
 * Create an app employee plus its Better Auth user + live session in the
 * component tables, wired together exactly like production
 * (`users.authId` ← auth user `_id`, identity `sessionId` ← session `_id`).
 */
export async function seedEmployee(
  t: T,
  opts: {
    email: string;
    role?: 'admin' | 'member';
    firstName?: string;
    lastName?: string;
    deletedAt?: number;
    /** Session expiry offset in ms; negative seeds an expired session. */
    sessionTtlMs?: number;
  },
): Promise<SeededEmployee> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const authUser = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'user',
        data: {
          email: opts.email,
          emailVerified: true,
          name: `${opts.firstName ?? 'Test'} ${opts.lastName ?? 'User'}`,
          createdAt: now,
          updatedAt: now,
        },
      },
    })) as { _id: string };
    const session = (await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'session',
        data: {
          userId: authUser._id,
          token: `test-token-${authUser._id}`,
          expiresAt: now + (opts.sessionTtlMs ?? 60 * 60 * 1000),
          createdAt: now,
          updatedAt: now,
        },
      },
    })) as { _id: string };
    const userId = await ctx.db.insert('users', {
      type: 'employee',
      role: opts.role ?? 'member',
      email: opts.email,
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? 'User',
      birthDate: '1970-01-01',
      jobTitle: 'CRM',
      phone: '',
      address: { street: '', streetNumber: '', postalCode: '', city: '', country: 'FR' },
      authId: authUser._id,
      updatedAt: now,
      ...(opts.deletedAt !== undefined ? { deletedAt: opts.deletedAt } : {}),
    });
    return {
      userId,
      authId: authUser._id,
      identity: { subject: authUser._id, sessionId: session._id },
    };
  });
}

/** `t.withIdentity` typed to accept the custom `sessionId` claim. */
export function asIdentity(t: T, identity: SeededEmployee['identity']) {
  return t.withIdentity(identity as Parameters<T['withIdentity']>[0]);
}

/**
 * Direct-db lead factory with schema-required defaults. Raw inserts bypass the
 * Triggers wrapper, so `searchText` is stamped here explicitly; aggregate
 * counters are NOT registered — count tests must create leads through the
 * mutations.
 */
export async function seedLead(
  t: T,
  fields: Partial<Doc<'leads'>> & { email?: string },
): Promise<Id<'leads'>> {
  return await t.run(async (ctx) => {
    const doc = {
      firstName: fields.firstName ?? 'Jean',
      lastName: fields.lastName ?? 'Dupont',
      email: fields.email ?? `lead-${Math.random().toString(36).slice(2)}@example.com`,
      phone: fields.phone ?? '',
      status: fields.status ?? 'nouveau',
      marketingConsent: fields.marketingConsent ?? [],
      consentToken: fields.consentToken ?? `test-consent-${Math.random().toString(36).slice(2)}`,
      isRedFlagged: fields.isRedFlagged ?? false,
      updatedAt: Date.now(),
      ...fields,
    } as Doc<'leads'>;
    return await ctx.db.insert('leads', { ...doc, searchText: leadSearchText(doc) });
  });
}
