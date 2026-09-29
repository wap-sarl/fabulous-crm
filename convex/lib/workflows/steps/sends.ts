import { internal } from '../../../_generated/api';
import type { Doc } from '../../../_generated/dataModel';
import type { QueryCtx } from '../../../_generated/server';
import type { WorkflowNode, WorkflowStepOutcome } from '../../../_lib/validators/workflows';
import { trySend } from '../../extensions/gates';
import { leadParams } from '../params';
import { advanceRun, logStep, type NodeOf, type StepContext } from '../runs';

/** What `runWorkflowActionStep` needs to perform one async step. */
export type ActionStepContext =
  | { kind: 'email'; to: string; subject: string; htmlBody: string; params: Record<string, string> }
  | { kind: 'sms'; phone: string; smsBody: string; params: Record<string, string> }
  | { kind: 'webhook'; url: string; payload: Record<string, unknown> }
  | null;

/** The step stays pending and the run on its node until `completeActionStep` advances it. */
async function startAction({ ctx, run }: StepContext, node: WorkflowNode): Promise<void> {
  const stepId = await logStep(ctx, run, node, 'pending');
  await ctx.scheduler.runAfter(0, internal.features.workflows.actions.runWorkflowActionStep, {
    runId: run._id,
    stepId,
    nodeId: node.id,
  });
}

/** A send is a marketing message: the contact must be reachable on the channel and have agreed to it, and the deployment must allow it. */
async function sendStep(
  step: StepContext,
  node: NodeOf<'send_email' | 'send_sms'>,
  channel: 'email' | 'sms',
  unreachable: WorkflowStepOutcome | null,
): Promise<void> {
  const { ctx, run, workflow, lead } = step;
  if (unreachable) {
    await logStep(ctx, run, node, unreachable);
    await advanceRun(ctx, run, workflow, node.next);
    return;
  }
  if (!lead.marketingConsent.includes(channel)) {
    await logStep(ctx, run, node, 'skipped_no_consent');
    await advanceRun(ctx, run, workflow, node.next);
    return;
  }
  const refused = await trySend(ctx, { channel, count: 1, source: 'workflow' });
  if (refused) {
    await logStep(ctx, run, node, 'skipped', { detail: refused });
    await advanceRun(ctx, run, workflow, node.next);
    return;
  }
  await startAction(step, node);
}

export async function sendEmailStep(step: StepContext, node: NodeOf<'send_email'>): Promise<void> {
  await sendStep(step, node, 'email', step.lead.email ? null : 'skipped_no_email');
}

export async function sendSmsStep(step: StepContext, node: NodeOf<'send_sms'>): Promise<void> {
  await sendStep(step, node, 'sms', step.lead.phone ? null : 'skipped_no_phone');
}

export async function webhookStep(step: StepContext, node: NodeOf<'webhook'>): Promise<void> {
  await startAction(step, node);
}

/** What the action sends for a node, null for a node that sends nothing or a contact that can no longer be reached. */
export async function actionStepContextOf(
  ctx: QueryCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'>,
  node: WorkflowNode,
  lead: Doc<'leads'>,
): Promise<ActionStepContext> {
  if (node.type === 'send_email' || node.type === 'send_sms') {
    const params = await leadParams(ctx, lead);
    if (node.type === 'send_email') {
      if (!lead.email) return null;
      return {
        kind: 'email',
        to: lead.email,
        subject: node.subject,
        htmlBody: node.htmlBody,
        params,
      };
    }
    if (!lead.phone) return null;
    return { kind: 'sms', phone: lead.phone, smsBody: node.smsBody, params };
  }

  if (node.type === 'webhook') {
    return {
      kind: 'webhook',
      url: node.url,
      payload: {
        workflow: { id: workflow._id, name: workflow.name },
        run: { id: run._id, enrolledAt: run.enrolledAt, triggerType: run.triggerType },
        node: { id: node.id },
        // consentToken deliberately excluded — it is a per-lead secret.
        lead: {
          id: lead._id,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          lifecycleStage: lead.lifecycleStage,
          comment: lead.comment,
          address: lead.address,
          marketingConsent: lead.marketingConsent,
          customProperties: lead.customProperties,
        },
        timestamp: Date.now(),
      },
    };
  }

  return null;
}
