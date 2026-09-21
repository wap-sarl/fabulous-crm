import type { FunctionArgs, SchedulableFunctionReference } from 'convex/server';
import { extensions } from '../extensions';
import type { ActionCtx, MutationCtx } from '../_generated/server';
import {
  refusalCode,
  SCHEDULED_WORK_RETRY_MS,
  type ScheduledWorkKind,
  type SendInfo,
  type SignInCodeInfo,
} from './extensionTypes';

// Every gate of the extension seam is invoked from here, named after the unit it bills (docs/extensions.md); the observers live in observers.ts.

/** A code about to be e-mailed, asked from the scheduled delivery so the sign-in request answers the same, as fast, either way. */
export async function gateSignInCode(ctx: ActionCtx, info: SignInCodeInfo): Promise<void> {
  await extensions.beforeSignInCode(ctx, info);
}

/** Leads about to become live; nothing is asked when none does. */
export async function gateLeadCreate(
  ctx: MutationCtx,
  count: number,
  source: 'crm' | 'import' | 'api',
): Promise<void> {
  if (count > 0) await extensions.beforeLeadCreate(ctx, { count, source });
}

/** One seat, with the open invitations an overlay may count as reserved. */
export async function gateInvitation(
  ctx: MutationCtx,
  stage: 'create' | 'accept',
  pending: number,
): Promise<void> {
  await extensions.beforeInvitation(ctx, { stage, pending });
}

/** Messages about to go out, for callers that propagate a refusal: creation, retry, resend. */
export async function requireSendAllowed(ctx: MutationCtx, info: SendInfo): Promise<void> {
  await extensions.beforeSend(ctx, info);
}

/** Messages about to go out, for callers that must not throw: the refusal code, or null when allowed. */
export async function trySend(ctx: MutationCtx, info: SendInfo): Promise<string | null> {
  try {
    await extensions.beforeSend(ctx, info);
    return null;
  } catch (error) {
    return refusalCode(error);
  }
}

/** Background work asks first; when refused, the same function is rescheduled later with the same args and `true` is returned. */
export async function deferUnlessAllowed<F extends SchedulableFunctionReference>(
  ctx: MutationCtx | ActionCtx,
  kind: ScheduledWorkKind,
  fn: F,
  args: FunctionArgs<F>,
): Promise<boolean> {
  if (await extensions.beforeScheduledWork(ctx, { kind })) return false;
  await ctx.scheduler.runAfter(SCHEDULED_WORK_RETRY_MS, fn, args);
  return true;
}
