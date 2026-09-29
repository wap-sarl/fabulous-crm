import type { Doc } from '../../../_generated/dataModel';
import type { MutationCtx } from '../../../_generated/server';
import { findLeadByEmail } from '../../../lib/leads/import';
import { isNotDeleted } from '../../../lib/shared/db';

/** The live contact a row names by its e-mail, looked up once per file. */
export async function leadOf(
  ctx: MutationCtx,
  caches: { leadByEmail: Map<string, Doc<'leads'> | null> },
  email: string,
): Promise<Doc<'leads'>> {
  if (!caches.leadByEmail.has(email))
    caches.leadByEmail.set(email, await findLeadByEmail(ctx, email));
  const lead = caches.leadByEmail.get(email);
  if (!lead || !isNotDeleted(lead)) throw new Error('contact_not_found');
  return lead;
}
