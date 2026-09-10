import { extensions } from '../extensions';
import type { MutationCtx } from '../_generated/server';
import type { SendInfo } from './extensionTypes';

/** The one gate every campaign send path goes through (creation, preparation, retry, resend); a refusal propagates as thrown. */
export async function requireSendAllowed(ctx: MutationCtx, info: SendInfo): Promise<void> {
  await extensions.beforeSend(ctx, info);
}
