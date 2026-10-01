import type { Doc } from '../../_generated/dataModel';
import type { CampaignTrackedLink } from '../../_lib/validators/crm';
import type { LifecycleConfig } from '../../_lib/validators/lifecycle';
import { buildLeadParams } from '../leads/targets';
import type { PropertyDefinitionDoc } from '../properties/definitions';
import { generateHexToken } from '../security/crypto';

// 8 bytes → 16 hex chars: short enough for SMS, ample for a low-value target.
const TRACKED_LINK_TOKEN_BYTES = 8;

/** Pure, the caller inserts the rows (the tokens need the send id); shared with the resend mutations so a re-materialized send has the shape of a fresh one. */
export function buildSendParams(
  lead: Doc<'leads'>,
  opts: {
    trackedLinks: CampaignTrackedLink[];
    defsById: Map<string, PropertyDefinitionDoc>;
    consentBase: string;
    linkBase: string | undefined;
    lifecycle: LifecycleConfig;
  },
): { params: Record<string, string>; tokens: { linkKey: string; token: string }[] } {
  const params = buildLeadParams(lead, opts.defsById, opts.consentBase, opts.lifecycle);
  // One fresh token per (recipient × tracked link); the URL is injected into params.
  const tokens = opts.trackedLinks.map((link) => {
    const token = generateHexToken(TRACKED_LINK_TOKEN_BYTES);
    params[link.key] = `${opts.linkBase}/l/${token}`;
    return { linkKey: link.key, token };
  });
  return { params, tokens };
}
