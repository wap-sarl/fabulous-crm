import type { HttpRouter } from 'convex/server';
import type { Doc } from '../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';

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
  /** Messages about to go out; `false` refuses them (`send_refused`, campaign `failed`, workflow step skipped). */
  beforeSend(ctx: MutationCtx, info: SendInfo): Promise<boolean>;
  /** A lead is about to be enrolled; `false` skips silently without failing the host write. */
  beforeWorkflowRun(ctx: MutationCtx, workflow: Doc<'workflows'>): Promise<boolean>;
  /** After API authentication and rate limits; a refusal answers instead of the route. */
  beforeApiRequest(ctx: ActionCtx, key: Doc<'apiKeys'>, method: string): Promise<ApiRefusal | null>;
  /** Extra HTTP routes, registered before the public API prefix routes. */
  registerHttpRoutes(http: HttpRouter): void;
}

export const defaultExtensions: Extensions = {
  beforeEmployeeCall: async () => {},
  publicConfig: async () => ({}),
  beforeInvitation: async () => {},
  beforeLeadCreate: async () => {},
  beforeSend: async () => true,
  beforeWorkflowRun: async () => true,
  beforeApiRequest: async () => null,
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
