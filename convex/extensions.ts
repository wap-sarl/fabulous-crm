import { defaultExtensions, type Extensions } from './lib/extensionTypes';

let active: Extensions = defaultExtensions;

export const extensions: Extensions = {
  beforeEmployeeCall: (ctx) => active.beforeEmployeeCall(ctx),
  publicConfig: (ctx) => active.publicConfig(ctx),
  beforeInvitation: (ctx, info) => active.beforeInvitation(ctx, info),
  beforeLeadCreate: (ctx, info) => active.beforeLeadCreate(ctx, info),
  beforeSend: (ctx, info) => active.beforeSend(ctx, info),
  beforeWorkflowRun: (ctx, workflow) => active.beforeWorkflowRun(ctx, workflow),
  beforeApiRequest: (ctx, key, method) => active.beforeApiRequest(ctx, key, method),
  beforeScheduledWork: (ctx, info) => active.beforeScheduledWork(ctx, info),
  registerHttpRoutes: (http) => active.registerHttpRoutes(http),
};

/** Test seam: bun tests run the functions in-process and swap hooks here; `null` restores the defaults. */
export function setExtensionsForTests(overrides: Partial<Extensions> | null): void {
  active = { ...defaultExtensions, ...(overrides ?? {}) };
}
