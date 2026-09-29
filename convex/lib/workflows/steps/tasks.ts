import { DAY_MS } from '../../../_lib/time';
import { createActivityRecord } from '../../activities/records';
import { renderPlaceholders } from '../../email/brevo';
import { leadParams } from '../params';
import { advanceRun, logStep, type NodeOf, type StepContext } from '../runs';

export async function createTaskStep(
  { ctx, run, workflow, lead }: StepContext,
  node: NodeOf<'create_task'>,
): Promise<void> {
  const params = await leadParams(ctx, lead);
  const team = node.teamId ? await ctx.db.get(node.teamId) : null;
  const teamId = team && team.deletedAt === undefined ? team._id : undefined;
  const ownerId =
    node.ownerId ??
    (teamId ? undefined : (lead.ownerIds[0] ?? workflow.createdBy ?? workflow.updatedBy));
  if (!teamId && (!ownerId || !(await ctx.db.get(ownerId)))) {
    await logStep(ctx, run, node, 'skipped', { detail: 'aucun propriétaire' });
  } else {
    const dueAt = node.dueInDays === undefined ? undefined : Date.now() + node.dueInDays * DAY_MS;
    const activityId = await createActivityRecord(
      ctx,
      {
        type: node.activityType ?? 'task',
        title: renderPlaceholders(node.title, params, false).trim() || node.title,
        description: node.description
          ? renderPlaceholders(node.description, params, false)
          : undefined,
        dueAt,
        ownerId,
        teamId,
        leadId: lead._id,
        companyId: lead.companyId,
      },
      { workflowId: workflow._id },
    );
    await logStep(ctx, run, node, 'success', { detail: `activité ${activityId}` });
  }
  await advanceRun(ctx, run, workflow, node.next);
}
