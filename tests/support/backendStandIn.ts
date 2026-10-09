import type { HttpRouter } from 'convex/server';
import { httpAction } from '../../convex/_generated/server';
import { defaultExtensions, type Extensions } from '../../convex/lib/extensions/types';

/** Stands in for an overlay's backend hooks when the suite is run with OVERLAY_STAND_IN, as an overlay behaves in a deployment that refuses nothing: every hook is defined and answers recognisably where an answer shows (the public config, the HTTP routes), and lets the product run where a refusal would stop it, as the private overlay does with no tenant configured. A test that counts on the core's own answers fails here unless it says so with `setExtensionsForTests(defaultExtensions)`. */
export const backendStandIn: Extensions = {
  ...defaultExtensions,
  publicConfig: async () => ({ standIn: true }),
  registerHttpRoutes: (http: HttpRouter) => {
    http.route({
      path: '/stand-in',
      method: 'GET',
      handler: httpAction(async () => new Response('stand-in')),
    });
  },
};

let active: Extensions = backendStandIn;

/** What `convex/extensions.ts` exports, as an overlay's does: hooks that follow `setExtensionsForTests`, and `null` putting back the stand-in's own, as `null` puts back the overlay's in an assembled tree. */
export const extensions: Extensions = {
  beforeEmployeeCall: (ctx) => active.beforeEmployeeCall(ctx),
  publicConfig: (ctx) => active.publicConfig(ctx),
  beforeSignInCode: (ctx, info) => active.beforeSignInCode(ctx, info),
  beforeInvitation: (ctx, info) => active.beforeInvitation(ctx, info),
  beforeLeadCreate: (ctx, info) => active.beforeLeadCreate(ctx, info),
  beforeSend: (ctx, info) => active.beforeSend(ctx, info),
  beforeWorkflowRun: (ctx, workflow) => active.beforeWorkflowRun(ctx, workflow),
  beforeApiRequest: (ctx, key, method) => active.beforeApiRequest(ctx, key, method),
  beforeScheduledWork: (ctx, info) => active.beforeScheduledWork(ctx, info),
  afterChange: (ctx, change) => active.afterChange(ctx, change),
  registerHttpRoutes: (http) => active.registerHttpRoutes(http),
};

export function setExtensionsForTests(overrides: Partial<Extensions> | null): void {
  active = { ...backendStandIn, ...(overrides ?? {}) };
}
