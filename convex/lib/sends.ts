import { extensions } from '../extensions';
import type { MutationCtx } from '../_generated/server';
import type { SendInfo } from './extensionTypes';

/** The one gate every campaign send path goes through (creation, preparation, retry, resend). */
export async function requireSendAllowed(ctx: MutationCtx, info: SendInfo): Promise<void> {
  if (!(await extensions.beforeSend(ctx, info))) throw new Error('send_refused');
}
