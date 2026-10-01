import type { QueryCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { consentOrigin } from '../config/appUrl';
import { loadLifecycleConfig } from '../leads/lifecycle';
import { buildLeadParams } from '../leads/targets';
import { loadPropertyDefinitions } from '../properties/definitions';

/** The placeholders a step can write from the contact: `{{ params.firstName }}`, its custom properties, its consent link. */
export async function leadParams(
  ctx: QueryCtx,
  lead: Doc<'leads'>,
): Promise<Record<string, string>> {
  const defs = await loadPropertyDefinitions(ctx, 'lead');
  const defsById = new Map(defs.map((d) => [d._id as string, d]));
  return buildLeadParams(lead, defsById, consentOrigin(), await loadLifecycleConfig(ctx));
}
