import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { refusal } from '../../_lib/refusal';
import { DEFAULT_EMAIL_TEMPLATES } from '../../_lib/validators/emailTemplates';
import { createAuditFields } from '../audit/log';
import { readCampaignStats } from '../campaigns/stats';
import { isNotDeleted } from '../shared/db';

/** The live template an id names, through the caller's scoped reader: out of reach reads as missing. */
export async function loadEmailTemplate(
  ctx: Pick<QueryCtx, 'db'>,
  templateId: Id<'emailTemplates'>,
): Promise<Doc<'emailTemplates'>> {
  const template = await ctx.db.get(templateId);
  if (!template || !isNotDeleted(template)) throw refusal('template_not_found');
  return template;
}

/** Every live template the caller may read, newest first. */
export async function listEmailTemplates(
  ctx: Pick<QueryCtx, 'db'>,
): Promise<Doc<'emailTemplates'>[]> {
  const rows = await ctx.db
    .query('emailTemplates')
    .withIndex('by_deletedAt', (q) => q.eq('deletedAt', undefined))
    .collect();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** The shipped templates, inserted when none exists, organisation-wide, owned by the given user. */
export async function ensureDefaultEmailTemplates(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
): Promise<Id<'emailTemplates'>[]> {
  if ((await ctx.db.query('emailTemplates').first()) !== null) return [];
  const ids: Id<'emailTemplates'>[] = [];
  for (const template of DEFAULT_EMAIL_TEMPLATES) {
    ids.push(
      await ctx.db.insert('emailTemplates', {
        ...template,
        ownerId,
        scope: 'organization',
        ...createAuditFields(ownerId),
      }),
    );
  }
  return ids;
}

// The figures of a template sum its last campaigns: a hundred of them read sixteen hundred rows, far below what a query may read.
const USAGE_CAMPAIGNS = 100;

export type TemplateUsage = {
  campaigns: number;
  workflows: number;
  sent: number;
  opened: number;
  clicked: number;
  // When the template was sent by more campaigns than are summed.
  partial: boolean;
};

/** What a template has been used for: the campaigns sent from it and their opens and clicks, the workflow steps that load it; a workflow e-mail is not tracked, so it counts and nothing more. */
export async function emailTemplateUsage(
  ctx: Pick<QueryCtx, 'db'>,
  templateId: Id<'emailTemplates'>,
): Promise<TemplateUsage> {
  const campaigns = await ctx.db
    .query('campaigns')
    .withIndex('by_template', (q) => q.eq('templateId', templateId))
    .order('desc')
    .take(USAGE_CAMPAIGNS + 1);
  const summed = campaigns.filter((c) => isNotDeleted(c)).slice(0, USAGE_CAMPAIGNS);
  const usage: TemplateUsage = {
    campaigns: summed.length,
    workflows: 0,
    sent: 0,
    opened: 0,
    clicked: 0,
    partial: campaigns.length > USAGE_CAMPAIGNS,
  };
  for (const campaign of summed) {
    const stats = await readCampaignStats(ctx, campaign._id);
    usage.sent += campaign.sentCount;
    usage.opened += stats.opened;
    usage.clicked += stats.clicked;
  }
  const workflows = await ctx.db.query('workflows').collect();
  for (const workflow of workflows) {
    if (!isNotDeleted(workflow)) continue;
    usage.workflows += workflow.nodes.filter(
      (node) => node.type === 'send_email' && node.templateId === templateId,
    ).length;
  }
  return usage;
}
