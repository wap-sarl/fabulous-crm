import { v } from 'convex/values';
import type { Doc } from '../../_generated/dataModel';
import { refusal } from '../../_lib/refusal';
import {
  abSplitPercentSchema,
  abWindowHoursSchema,
  type CampaignAbTest,
  type CampaignStats,
  type CampaignVariant,
} from '../../_lib/validators/crm';
import { follows } from '../../_lib/validators/fields';

/** The test as the composer sends it: the winner is the drain's to write. */
export const abTestArgs = v.object({
  kind: v.union(v.literal('subject'), v.literal('content')),
  subjectB: v.optional(v.string()),
  htmlBodyB: v.optional(v.string()),
  splitPercent: v.number(),
  windowHours: v.number(),
  metric: v.union(v.literal('opens'), v.literal('clicks')),
});

/** A test needs a custom e-mail, a variant B of the kind it tests, and bounds the drain can live with. */
export function checkAbTest(
  test: Omit<CampaignAbTest, 'winner' | 'decidedAt'>,
  htmlBody: string | undefined,
): CampaignAbTest {
  if (!htmlBody) {
    throw refusal('ab_test_unavailable', {
      message: 'Un test A/B porte sur un e-mail rédigé dans l’éditeur.',
    });
  }
  const subjectB = test.kind === 'subject' ? test.subjectB?.trim() : undefined;
  const htmlBodyB = test.kind === 'content' ? test.htmlBodyB?.trim() : undefined;
  if (test.kind === 'subject' ? !subjectB : !htmlBodyB) {
    throw refusal('ab_variant_required', {
      message:
        test.kind === 'subject'
          ? 'L’objet de la variante B est requis.'
          : 'Le contenu de la variante B est requis.',
    });
  }
  if (
    !follows(abSplitPercentSchema, test.splitPercent) ||
    !follows(abWindowHoursSchema, test.windowHours)
  ) {
    throw refusal('ab_test_invalid', {
      message: 'La part testée va de 10 à 50 % et la fenêtre de 1 à 72 heures.',
    });
  }
  return {
    kind: test.kind,
    subjectB,
    htmlBodyB,
    splitPercent: test.splitPercent,
    windowHours: test.windowHours,
    metric: test.metric,
  };
}

/** A small hash (FNV-1a) of the campaign and the lead, out of ten thousand: the same recipient lands in the same group on a resend. */
function bucketOf(campaignId: string, leadId: string): number {
  let hash = 0x811c9dc5;
  for (const char of `${campaignId}:${leadId}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10_000;
}

/** A or B for a recipient in the test group (the share of the audience, halved), nothing for the holdout. */
export function assignVariant(
  campaignId: string,
  leadId: string,
  splitPercent: number,
): CampaignVariant | undefined {
  const bucket = bucketOf(campaignId, leadId);
  const share = splitPercent * 100;
  if (bucket >= share) return undefined;
  return bucket < share / 2 ? 'A' : 'B';
}

/** The subject and body a send carries: B's for the variant it tests, the campaign's own otherwise. */
export function variantContent(
  campaign: Pick<Doc<'campaigns'>, 'subject' | 'htmlBody' | 'abTest'>,
  variant: CampaignVariant | undefined,
): { subject: string | undefined; htmlBody: string | undefined } {
  const test = campaign.abTest;
  if (variant !== 'B' || !test) return { subject: campaign.subject, htmlBody: campaign.htmlBody };
  return test.kind === 'subject'
    ? { subject: test.subjectB ?? campaign.subject, htmlBody: campaign.htmlBody }
    : { subject: campaign.subject, htmlBody: test.htmlBodyB ?? campaign.htmlBody };
}

export type Decision = { winner: CampaignVariant; decidedBy: 'result' | 'fallback' };

/** The variant the metric prefers, by its rate over the sends of the variant; A on a tie. Without a send or a result on either side, A by default, and said so. */
export function pickWinner(stats: CampaignStats, metric: CampaignAbTest['metric']): Decision {
  const rate = (variant: CampaignVariant): number => {
    const figures = stats.variants?.[variant];
    if (!figures || figures.sent === 0) return 0;
    return (metric === 'opens' ? figures.opened : figures.clicked) / figures.sent;
  };
  const a = rate('A');
  const b = rate('B');
  if (a === 0 && b === 0) return { winner: 'A', decidedBy: 'fallback' };
  return { winner: b > a ? 'B' : 'A', decidedBy: 'result' };
}
