import { v } from 'convex/values';
import { internalQuery, type MutationCtx } from '../../_generated/server';
// Trigger-wrapped constructor: keeps the lead aggregates in sync (functions.ts).
import { internalMutation } from '../../_lib/functions';
import type { Doc, Id } from '../../_generated/dataModel';
import { internal } from '../../_generated/api';
import { appOrigin, deleteListMember, insertListMember, isNotDeleted, logAudit } from '../../lib';
import { evalAdvancedFilter } from '../crm/leadMatching';
import { loadLeadFilterExtras } from '../crm/leadTableFilters';
import { buildLeadParams, buildLeadTargetPatch } from '../crm/leadTargets';
import {
  applyLifecycleTransition,
  loadLifecycleConfig,
  planLifecycleTransition,
} from '../../lib/lifecycle';
import { createDealRecord, latestOpenDealOfLead, moveDealToStage } from '../../lib/deals';
import { createActivityRecord } from '../../lib/activities';
import { renderPlaceholders } from '../../lib/emailUtils';
import { workflowStepOutcomeValidator } from '../../_lib/validators/workflows';
import type { WorkflowNode, WorkflowStepOutcome } from '../../_lib/validators/workflows';
import type { FilterField, LeadStandardField } from '../../_lib/validators/filters';
import { loadPropertyDefinitions } from '../../lib/properties';
import {
  delayMs,
  diffLeadFilterFields,
  MAX_ENROLLMENTS_PER_LEAD_PER_DAY,
  MAX_STEPS_PER_RUN,
} from './lib';
import { dispatchWorkflowTrigger, enrollLead } from './triggerDispatch';

/**
 * The workflow execution engine. One node per `executeStep` invocation, each
 * its own transaction, chained with `scheduler.runAfter(0)` (the campaign
 * batch drain pattern) — so the step log is visible live and a crash never
 * loses more than one step. Async side effects (sends, webhooks) run in a
 * node action between a 'pending' step row and `completeActionStep`.
 */

/** Insert a workflowRunSteps row. Non-pending outcomes are final immediately. */
async function logStep(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  node: WorkflowNode,
  status: WorkflowStepOutcome,
  extra?: { detail?: string; branchResult?: boolean },
): Promise<Id<'workflowRunSteps'>> {
  const now = Date.now();
  return await ctx.db.insert('workflowRunSteps', {
    runId: run._id,
    workflowId: run.workflowId,
    leadId: run.leadId,
    nodeId: node.id,
    nodeType: node.type,
    status,
    startedAt: now,
    finishedAt: status === 'pending' ? undefined : now,
    branchResult: extra?.branchResult,
    detail: extra?.detail,
  });
}

/**
 * Move a run past an executed node: park it on `nextId` and schedule that
 * step, or finish the run when the path ends. `scheduleNext: false` (workflow
 * paused mid-action) advances the pointer without scheduling — resume kicks it.
 */
async function advanceRun(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'>,
  nextId: string | undefined,
  scheduleNext = true,
): Promise<void> {
  if (nextId === undefined) {
    await ctx.db.patch(run._id, {
      status: 'completed',
      finishedAt: Date.now(),
      currentNodeId: undefined,
      wakeAt: undefined,
      scheduledFnId: undefined,
    });
    await ctx.db.patch(workflow._id, {
      activeCount: Math.max(0, workflow.activeCount - 1),
      completedCount: workflow.completedCount + 1,
    });
    return;
  }
  await ctx.db.patch(run._id, {
    currentNodeId: nextId,
    wakeAt: undefined,
    scheduledFnId: undefined,
  });
  if (scheduleNext) {
    await ctx.scheduler.runAfter(0, internal.features.workflows.internal.executeStep, {
      runId: run._id,
      nodeId: nextId,
    });
  }
}

/** Fail a run on a structural problem (removed node, deleted workflow…). */
async function failRun(
  ctx: MutationCtx,
  run: Doc<'workflowRuns'>,
  workflow: Doc<'workflows'> | null,
  error: string,
): Promise<void> {
  await ctx.db.patch(run._id, {
    status: 'failed',
    finishedAt: Date.now(),
    currentNodeId: undefined,
    wakeAt: undefined,
    scheduledFnId: undefined,
    error,
  });
  if (workflow) {
    await ctx.db.patch(workflow._id, { activeCount: Math.max(0, workflow.activeCount - 1) });
  }
}

/** The `changedFields` payload for an engine-made property write. */
function targetAsFilterField(
  target: Extract<WorkflowNode, { type: 'update_property' }>['target'],
): FilterField<LeadStandardField> {
  return target.kind === 'custom'
    ? { kind: 'custom', definitionId: target.propertyDefId }
    : { kind: 'standard', field: target.field };
}

/**
 * Execute the node a run is parked on. Idempotency guards make duplicate or
 * stale schedules no-ops, so pause/resume and webhook replays are safe:
 * a run only ever executes its `currentNodeId`, exactly once.
 */
export const executeStep = internalMutation({
  args: { runId: v.id('workflowRuns'), nodeId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const run = await ctx.db.get(args.runId);
    if (run?.status !== 'active') return;
    // Stale schedule (the run already advanced past this node) — no-op.
    if (run.currentNodeId !== args.nodeId) return;

    const workflow = await ctx.db.get(run.workflowId);
    if (!workflow || workflow.deletedAt !== undefined) {
      await failRun(
        ctx,
        run,
        workflow?.deletedAt !== undefined ? workflow : null,
        'workflow_deleted',
      );
      return;
    }
    // Paused: leave the run parked; setWorkflowStatus re-kicks it on resume.
    if (workflow.status !== 'active') return;

    // An async action is still in flight for this run (e.g. resume clicked while
    // a send hadn't completed) — completeActionStep will advance it.
    const steps = await ctx.db
      .query('workflowRunSteps')
      .withIndex('by_run', (q) => q.eq('runId', run._id))
      .collect();
    if (steps.some((s) => s.status === 'pending')) return;

    const node = workflow.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      await failRun(ctx, run, workflow, 'step_removed');
      return;
    }
    if (run.stepCount >= MAX_STEPS_PER_RUN) {
      await failRun(ctx, run, workflow, 'step_limit');
      return;
    }

    const lead = await ctx.db.get(run.leadId);
    if (!lead || lead.deletedAt !== undefined) {
      await ctx.db.patch(run._id, {
        status: 'cancelled',
        finishedAt: Date.now(),
        currentNodeId: undefined,
        wakeAt: undefined,
        scheduledFnId: undefined,
        error: 'lead_supprime',
      });
      await ctx.db.patch(workflow._id, { activeCount: Math.max(0, workflow.activeCount - 1) });
      return;
    }

    await ctx.db.patch(run._id, { stepCount: run.stepCount + 1 });
    const source = { runId: run._id, workflowId: workflow._id };

    switch (node.type) {
      case 'branch': {
        const extras = await loadLeadFilterExtras(ctx, lead._id, node.condition);
        const result = evalAdvancedFilter(lead, node.condition, extras);
        await logStep(ctx, run, node, 'success', { branchResult: result });
        await advanceRun(ctx, run, workflow, result ? node.nextTrue : node.nextFalse);
        return;
      }

      case 'wait': {
        // A wait with nothing after it is a no-op end of path.
        if (node.next === undefined) {
          await logStep(ctx, run, node, 'success');
          await advanceRun(ctx, run, workflow, undefined);
          return;
        }
        const wakeAt = Date.now() + delayMs(node);
        await logStep(ctx, run, node, 'success', {
          detail: `réveil le ${new Date(wakeAt).toISOString()}`,
        });
        const scheduledFnId = await ctx.scheduler.runAt(
          wakeAt,
          internal.features.workflows.internal.executeStep,
          { runId: run._id, nodeId: node.next },
        );
        await ctx.db.patch(run._id, { currentNodeId: node.next, wakeAt, scheduledFnId });
        return;
      }

      case 'update_property': {
        const patch = await buildLeadTargetPatch(ctx, lead, node.target, node.value);
        if (!patch) {
          await logStep(ctx, run, node, 'skipped', { detail: 'cible invalide ou supprimée' });
        } else {
          const changedFields = diffLeadFilterFields(lead, patch).length
            ? [targetAsFilterField(node.target)]
            : [];
          await ctx.db.patch(lead._id, { ...patch, updatedAt: Date.now() });
          await logStep(ctx, run, node, 'success');
          if (changedFields.length > 0) {
            await dispatchWorkflowTrigger(
              ctx,
              lead._id,
              { type: 'lead_property_changed', changedFields },
              { source },
            );
          }
        }
        await advanceRun(ctx, run, workflow, node.next);
        return;
      }

      case 'set_lifecycle_stage': {
        const config = await loadLifecycleConfig(ctx);
        const plan = node.stage
          ? planLifecycleTransition(config, lead, node.stage)
          : ({ kind: 'unknown_stage' } as const);
        switch (plan.kind) {
          case 'unknown_stage':
            await logStep(ctx, run, node, 'skipped', { detail: 'statut introuvable' });
            break;
          case 'regression_blocked':
            await logStep(ctx, run, node, 'skipped', { detail: 'retour en arrière interdit' });
            break;
          case 'unchanged':
            await logStep(ctx, run, node, 'success', { detail: 'déjà à ce statut' });
            break;
          case 'change':
            await applyLifecycleTransition(ctx, lead._id, plan, {
              source: 'workflow',
              workflowId: workflow._id,
            });
            await logStep(ctx, run, node, 'success');
            await dispatchWorkflowTrigger(
              ctx,
              lead._id,
              {
                type: 'lead_property_changed',
                changedFields: [{ kind: 'standard', field: 'lifecycleStage' }],
              },
              { source },
            );
            break;
        }
        await advanceRun(ctx, run, workflow, node.next);
        return;
      }

      case 'create_deal': {
        const defs = await loadPropertyDefinitions(ctx, 'lead');
        const defsById = new Map(defs.map((d) => [d._id as string, d]));
        const params = buildLeadParams(
          lead,
          defsById,
          appOrigin() || 'http://localhost:4202',
          await loadLifecycleConfig(ctx),
        );
        const title = renderPlaceholders(node.title, params, false).trim();
        try {
          const dealId = await createDealRecord(
            ctx,
            {
              title: title || node.title,
              amount: node.amount,
              currency: node.currency,
              pipelineId: node.pipelineId,
              stageKey: node.stageKey,
              ownerIds: lead.ownerIds,
              leadId: lead._id,
            },
            { source: 'workflow', workflowId: workflow._id, runSource: source },
          );
          await logStep(ctx, run, node, 'success', { detail: `transaction ${dealId}` });
        } catch (e) {
          await logStep(ctx, run, node, 'skipped', {
            detail: e instanceof Error ? e.message : 'pipeline introuvable',
          });
        }
        await advanceRun(ctx, run, workflow, node.next);
        return;
      }

      case 'create_task': {
        const defs = await loadPropertyDefinitions(ctx, 'lead');
        const defsById = new Map(defs.map((d) => [d._id as string, d]));
        const params = buildLeadParams(
          lead,
          defsById,
          appOrigin() || 'http://localhost:4202',
          await loadLifecycleConfig(ctx),
        );
        const team = node.teamId ? await ctx.db.get(node.teamId) : null;
        const teamId = team && team.deletedAt === undefined ? team._id : undefined;
        const ownerId =
          node.ownerId ??
          (teamId ? undefined : (lead.ownerIds[0] ?? workflow.createdBy ?? workflow.updatedBy));
        if (!teamId && (!ownerId || !(await ctx.db.get(ownerId)))) {
          await logStep(ctx, run, node, 'skipped', { detail: 'aucun propriétaire' });
        } else {
          const dueAt =
            node.dueInDays === undefined ? undefined : Date.now() + node.dueInDays * DAY_MS;
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
        return;
      }

      case 'update_deal_stage': {
        const deal = await latestOpenDealOfLead(ctx, lead._id, node.pipelineId);
        if (!deal || !node.stageKey) {
          await logStep(ctx, run, node, 'skipped', { detail: 'aucune transaction ouverte' });
        } else {
          const move = await moveDealToStage(
            ctx,
            deal,
            node.stageKey,
            { source: 'workflow', workflowId: workflow._id, runSource: source },
            { tags: node.tags },
          );
          if (move.kind === 'unknown_stage') {
            await logStep(ctx, run, node, 'skipped', { detail: 'stade introuvable' });
          } else if (move.kind === 'unknown_tag') {
            await logStep(ctx, run, node, 'skipped', { detail: 'étiquette introuvable' });
          } else if (move.kind === 'tag_required') {
            await logStep(ctx, run, node, 'skipped', { detail: 'étiquette requise' });
          } else if (move.kind === 'forbidden') {
            await logStep(ctx, run, node, 'skipped', {
              detail: `transition interdite depuis « ${deal.stageKey} »`,
            });
          } else if (move.kind === 'unchanged') {
            await logStep(ctx, run, node, 'success', { detail: 'déjà à ce stade' });
          } else {
            await logStep(ctx, run, node, 'success', { detail: `transaction ${deal._id}` });
          }
        }
        await advanceRun(ctx, run, workflow, node.next);
        return;
      }

      case 'add_to_list': {
        const listId = node.listId;
        const list = listId ? await ctx.db.get(listId) : null;
        if (!listId || !list) {
          await logStep(ctx, run, node, 'skipped', { detail: 'liste introuvable' });
        } else if (list.kind === 'dynamic') {
          await logStep(ctx, run, node, 'skipped', {
            detail: 'liste dynamique (membres calculés)',
          });
        } else {
          const existing = await ctx.db
            .query('leadListMembers')
            .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', lead._id))
            .first();
          if (existing) {
            await logStep(ctx, run, node, 'success', { detail: 'déjà dans la liste' });
          } else {
            // Junction rows require an author; attribute to the workflow's owner.
            const addedBy = workflow.createdBy ?? workflow.updatedBy;
            if (!addedBy) {
              await logStep(ctx, run, node, 'skipped', { detail: 'workflow sans auteur' });
            } else {
              await insertListMember(ctx, { listId, leadId: lead._id, addedBy });
              await logStep(ctx, run, node, 'success');
              await dispatchWorkflowTrigger(
                ctx,
                lead._id,
                { type: 'list_membership_changed', change: 'added', listId },
                { source },
              );
            }
          }
        }
        await advanceRun(ctx, run, workflow, node.next);
        return;
      }

      case 'remove_from_list': {
        const listId = node.listId;
        const list = listId ? await ctx.db.get(listId) : null;
        if (!listId || !list) {
          await logStep(ctx, run, node, 'skipped', { detail: 'liste introuvable' });
          await advanceRun(ctx, run, workflow, node.next);
          return;
        }
        if (list.kind === 'dynamic') {
          await logStep(ctx, run, node, 'skipped', {
            detail: 'liste dynamique (membres calculés)',
          });
          await advanceRun(ctx, run, workflow, node.next);
          return;
        }
        const member = await ctx.db
          .query('leadListMembers')
          .withIndex('by_list_lead', (q) => q.eq('listId', listId).eq('leadId', lead._id))
          .first();
        if (!member) {
          await logStep(ctx, run, node, 'success', { detail: 'déjà hors de la liste' });
        } else {
          await deleteListMember(ctx, member);
          await logStep(ctx, run, node, 'success');
          await dispatchWorkflowTrigger(
            ctx,
            lead._id,
            { type: 'list_membership_changed', change: 'removed', listId },
            { source },
          );
        }
        await advanceRun(ctx, run, workflow, node.next);
        return;
      }

      case 'send_email': {
        if (!lead.email) {
          await logStep(ctx, run, node, 'skipped_no_email');
          await advanceRun(ctx, run, workflow, node.next);
          return;
        }
        // Server-side consent gate — workflow sends are marketing messages.
        if (!lead.marketingConsent.includes('email')) {
          await logStep(ctx, run, node, 'skipped_no_consent');
          await advanceRun(ctx, run, workflow, node.next);
          return;
        }
        const stepId = await logStep(ctx, run, node, 'pending');
        await ctx.scheduler.runAfter(0, internal.features.workflows.actions.runWorkflowActionStep, {
          runId: run._id,
          stepId,
          nodeId: node.id,
        });
        // currentNodeId stays on this node until completeActionStep advances it.
        return;
      }

      case 'send_sms': {
        if (!lead.phone) {
          await logStep(ctx, run, node, 'skipped_no_phone');
          await advanceRun(ctx, run, workflow, node.next);
          return;
        }
        if (!lead.marketingConsent.includes('sms')) {
          await logStep(ctx, run, node, 'skipped_no_consent');
          await advanceRun(ctx, run, workflow, node.next);
          return;
        }
        const stepId = await logStep(ctx, run, node, 'pending');
        await ctx.scheduler.runAfter(0, internal.features.workflows.actions.runWorkflowActionStep, {
          runId: run._id,
          stepId,
          nodeId: node.id,
        });
        return;
      }

      case 'webhook': {
        const stepId = await logStep(ctx, run, node, 'pending');
        await ctx.scheduler.runAfter(0, internal.features.workflows.actions.runWorkflowActionStep, {
          runId: run._id,
          stepId,
          nodeId: node.id,
        });
        return;
      }
    }
  },
});

/** What `runWorkflowActionStep` needs to perform one async step. */
export type ActionStepContext =
  | { kind: 'email'; to: string; subject: string; htmlBody: string; params: Record<string, string> }
  | { kind: 'sms'; phone: string; smsBody: string; params: Record<string, string> }
  | { kind: 'webhook'; url: string; payload: Record<string, unknown> }
  | null;

/**
 * Read side of an async action step. Returns `null` when the run/node is no
 * longer actionable (cancelled meanwhile, node edited away…) — the action then
 * completes the step as skipped.
 */
export const getActionStepContext = internalQuery({
  args: { runId: v.id('workflowRuns'), stepId: v.id('workflowRunSteps'), nodeId: v.string() },
  handler: async (ctx, args): Promise<ActionStepContext> => {
    const run = await ctx.db.get(args.runId);
    if (run?.status !== 'active' || run.currentNodeId !== args.nodeId) return null;
    const workflow = await ctx.db.get(run.workflowId);
    if (!workflow || workflow.deletedAt !== undefined) return null;
    const node = workflow.nodes.find((n) => n.id === args.nodeId);
    if (!node) return null;
    const lead = await ctx.db.get(run.leadId);
    if (!lead || lead.deletedAt !== undefined) return null;

    if (node.type === 'send_email' || node.type === 'send_sms') {
      const defs = await loadPropertyDefinitions(ctx, 'lead');
      const defsById = new Map(defs.map((d) => [d._id as string, d]));
      const params = buildLeadParams(
        lead,
        defsById,
        appOrigin() || 'http://localhost:4202',
        await loadLifecycleConfig(ctx),
      );
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
  },
});

/**
 * Record an async step's outcome and advance the run. The step already
 * happened externally, so the pointer always advances — but the next step is
 * only scheduled while the workflow is active (paused runs park on it).
 */
export const completeActionStep = internalMutation({
  args: {
    runId: v.id('workflowRuns'),
    stepId: v.id('workflowRunSteps'),
    nodeId: v.string(),
    status: workflowStepOutcomeValidator,
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const step = await ctx.db.get(args.stepId);
    if (step && step.status === 'pending') {
      await ctx.db.patch(args.stepId, {
        status: args.status,
        detail: args.detail,
        finishedAt: Date.now(),
      });
    }

    const run = await ctx.db.get(args.runId);
    if (run?.status !== 'active' || run.currentNodeId !== args.nodeId) return;
    const workflow = await ctx.db.get(run.workflowId);
    if (!workflow || workflow.deletedAt !== undefined) {
      await failRun(ctx, run, workflow ?? null, 'workflow_deleted');
      return;
    }
    const node = workflow.nodes.find((n) => n.id === args.nodeId);
    if (!node) {
      await failRun(ctx, run, workflow, 'step_removed');
      return;
    }
    const next = node.type === 'branch' ? undefined : node.next;
    await advanceRun(ctx, run, workflow, next, workflow.status === 'active');
  },
});

// Leads examined per reenrollBatch transaction. Each matching lead reads its
// runs and writes a run cancellation + a fresh run + workflow counter patches,
// so 100 leads per page stays far below the per-transaction limits.
const REENROLL_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export const reenrollBatch = internalMutation({
  args: { workflowId: v.id('workflows'), cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ isDone: boolean; continueCursor: string | null }> => {
    const workflow = await ctx.db.get(args.workflowId);
    if (
      !workflow ||
      workflow.deletedAt != null ||
      workflow.status !== 'active' ||
      workflow.bulkReenroll?.status !== 'running'
    ) {
      return { isDone: true, continueCursor: null };
    }

    const page = await ctx.db
      .query('leads')
      .paginate({ cursor: args.cursor ?? null, numItems: REENROLL_BATCH });

    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let matched = 0;
    let enrolled = 0;
    let cancelled = 0;
    let skipped = 0;
    for (const lead of page.page) {
      if (!isNotDeleted(lead)) continue;
      if (workflow.enrollmentCriteria) {
        const extras = await loadLeadFilterExtras(ctx, lead._id, workflow.enrollmentCriteria);
        if (!evalAdvancedFilter(lead, workflow.enrollmentCriteria, extras)) continue;
      }
      matched++;

      const runs = await ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow_lead', (q) =>
          q.eq('workflowId', args.workflowId).eq('leadId', lead._id),
        )
        .collect();

      // Daily cap, checked before cancelling anything: a capped lead keeps its
      // in-flight run instead of losing it and getting nothing back.
      if (runs.filter((r) => r.enrolledAt > dayAgo).length >= MAX_ENROLLMENTS_PER_LEAD_PER_DAY) {
        skipped++;
        continue;
      }

      for (const run of runs) {
        if (run.status !== 'active') continue;
        if (run.scheduledFnId) await ctx.scheduler.cancel(run.scheduledFnId);
        await ctx.db.patch(run._id, {
          status: 'cancelled',
          finishedAt: Date.now(),
          currentNodeId: undefined,
          wakeAt: undefined,
          scheduledFnId: undefined,
        });
        cancelled++;
      }

      const runId = await enrollLead(ctx, workflow, lead._id, 'bulk_reenroll');
      if (runId) enrolled++;
    }

    // Fold this batch into the progress state. Re-read the workflow first:
    // enrollLead patched its counters for every enrolled lead above, and the
    // cancellations bypassed advanceRun, so activeCount must shrink by
    // `cancelled` here.
    const fresh = await ctx.db.get(args.workflowId);
    if (!fresh || fresh.bulkReenroll?.status !== 'running') {
      return { isDone: true, continueCursor: null };
    }
    const progress = {
      status: 'running' as const,
      startedBy: fresh.bulkReenroll.startedBy,
      matched: fresh.bulkReenroll.matched + matched,
      enrolled: fresh.bulkReenroll.enrolled + enrolled,
      cancelled: fresh.bulkReenroll.cancelled + cancelled,
      skipped: fresh.bulkReenroll.skipped + skipped,
      startedAt: fresh.bulkReenroll.startedAt,
    };
    if (!page.isDone) {
      await ctx.db.patch(args.workflowId, {
        activeCount: Math.max(0, fresh.activeCount - cancelled),
        bulkReenroll: progress,
      });
      await ctx.scheduler.runAfter(0, internal.features.workflows.internal.reenrollBatch, {
        workflowId: args.workflowId,
        cursor: page.continueCursor,
      });
      return { isDone: false, continueCursor: page.continueCursor };
    }

    await ctx.db.patch(args.workflowId, {
      activeCount: Math.max(0, fresh.activeCount - cancelled),
      bulkReenroll: { ...progress, status: 'done', finishedAt: Date.now() },
    });
    await logAudit({
      ctx,
      userId: progress.startedBy,
      entityType: 'workflow',
      entityId: args.workflowId,
      action: 'update',
      metadata: {
        event: 'bulk_reenroll',
        matched: progress.matched,
        enrolled: progress.enrolled,
        cancelled: progress.cancelled,
        skipped: progress.skipped,
      },
    });
    return { isDone: true, continueCursor: page.continueCursor };
  },
});
