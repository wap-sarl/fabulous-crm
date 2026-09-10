import type { HttpRouter } from 'convex/server';
import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

/** The background entry points that ask before running (`beforeScheduledWork`). */
export type ScheduledWorkKind =
  | 'campaign_prepare'
  | 'campaign_drain'
  | 'workflow_step'
  | 'workflow_action';

/** A deferred background function runs again this much later. */
export const SCHEDULED_WORK_RETRY_MS = 15 * 60 * 1000;

/** The code of a refusal: `data.code` of a ConvexError (structured refusals), else the error message. */
export function refusalCode(error: unknown): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string') {
      return (data as { code: string }).code;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

export interface ApiRefusal {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface Extensions {
  /** First thing every employee, settings and employee-action wrapper does; throw to refuse. */
  beforeEmployeeCall(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<void>;
  /** Extra fields merged into `getPublicConfig`, readable before login. */
  publicConfig(ctx: QueryCtx): Promise<Record<string, unknown>>;
  /** Invitation about to be created or accepted; `pending` counts the open ones; throw to refuse. */
  beforeInvitation(
    ctx: MutationCtx,
    info: { stage: 'create' | 'accept'; pending: number },
  ): Promise<void>;
  /** Leads about to become live, by insertion or by reviving a soft-deleted one (`count` is an upper bound for imports); throw to refuse. */
  beforeLeadCreate(
    ctx: MutationCtx,
    info: { count: number; source: 'crm' | 'import' | 'api' },
  ): Promise<void>;
  /** Messages about to go out; throw to refuse (creation and resend propagate it, a preparation page fails the campaign, a workflow step is skipped). */
  beforeSend(ctx: MutationCtx, info: SendInfo): Promise<void>;
  /** A lead is about to be enrolled; `false` skips silently without failing the host write. */
  beforeWorkflowRun(ctx: MutationCtx, workflow: Doc<'workflows'>): Promise<boolean>;
  /** After API authentication and rate limits; a refusal answers instead of the route. */
  beforeApiRequest(ctx: ActionCtx, key: Doc<'apiKeys'>, method: string): Promise<ApiRefusal | null>;
  /** Background work about to run; `false` defers it by SCHEDULED_WORK_RETRY_MS with nothing changed. */
  beforeScheduledWork(
    ctx: MutationCtx | ActionCtx,
    info: { kind: ScheduledWorkKind },
  ): Promise<boolean>;
  /** Extra HTTP routes, registered before the public API prefix routes. */
  registerHttpRoutes(http: HttpRouter): void;
}

export const defaultExtensions: Extensions = {
  beforeEmployeeCall: async () => {},
  publicConfig: async () => ({}),
  beforeInvitation: async () => {},
  beforeLeadCreate: async () => {},
  beforeSend: async () => {},
  beforeWorkflowRun: async () => true,
  beforeApiRequest: async () => null,
  beforeScheduledWork: async () => true,
  registerHttpRoutes: () => {},
}; /** Campaign sends are checked at creation (count 1), on every preparation page with the running count, and on retries. */
export type SendInfo =
  | {
      source: 'campaign';
      channel: 'email' | 'sms';
      count: number;
      stage: 'create' | 'preparing' | 'prepared' | 'resend';
    }
  | { source: 'workflow'; channel: 'email' | 'sms'; count: 1 };
