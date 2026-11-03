import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { pipelineStage } from '../../_lib/validators/deals';
import type { NotificationEventData } from '../../_lib/validators/notifications';
import { moduleAllows, type Visibility } from '../roles/visibility';
import { settingsUsers, teamMatesOf } from './audience';

// What a fact says to the people it concerns, read from the record when the fan-out runs.

type Ctx = QueryCtx | MutationCtx;

/** The text of a notification and the people it is for; null when the record is gone. */
export interface Rendered {
  recipients: Id<'users'>[];
  title: string;
  body: string;
  path: string;
  /** The actor is told too: the kind reports the end of their own long work. */
  tellActor?: boolean;
  /** Whether a recipient may see the record: the inbox never shows what the record's own access rules hide. Absent, everyone in the audience may. */
  visible?: (visibility: Visibility) => boolean;
}

const byCreator = (doc: { createdBy?: Id<'users'> }) => (doc.createdBy ? [doc.createdBy] : []);

const personName = (user: Pick<Doc<'users'>, 'firstName' | 'lastName'> | null | undefined) =>
  user ? `${user.firstName} ${user.lastName}`.trim() : 'Quelqu’un';

const leadName = (lead: Pick<Doc<'leads'>, 'firstName' | 'lastName'>) =>
  `${lead.firstName} ${lead.lastName}`.trim() || 'un contact';

const assignedOf = (data: NotificationEventData | undefined): Id<'users'>[] =>
  Array.isArray(data?.assigned) ? (data.assigned as Id<'users'>[]) : [];

const live = <T extends { deletedAt?: number }>(doc: T | null): T | null =>
  doc && doc.deletedAt === undefined ? doc : null;

async function actorName(ctx: Ctx, actorId: Id<'users'> | undefined): Promise<string> {
  return personName(actorId ? await ctx.db.get(actorId) : null);
}

export async function renderLeadAssigned(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const lead = live(await ctx.db.get(event.entity.id as Id<'leads'>));
  if (!lead) return null;
  const name = leadName(lead);
  return {
    recipients: assignedOf(event.data),
    visible: (vis) => moduleAllows(vis, 'leads', lead.ownerIds),
    title: `Lead attribué : ${name}`,
    body: `${await actorName(ctx, event.actorId)} vous a attribué le lead ${name}.`,
    path: `/leads/${lead._id}`,
  };
}

export async function renderFormSubmitted(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const lead = live(await ctx.db.get(event.entity.id as Id<'leads'>));
  const formId = typeof event.data?.formId === 'string' ? (event.data.formId as Id<'forms'>) : null;
  const form = formId ? await ctx.db.get(formId) : null;
  if (!lead || !form) return null;
  return {
    recipients: form.createdBy ? [form.createdBy] : await settingsUsers(ctx),
    visible: (vis) => moduleAllows(vis, 'leads', lead.ownerIds),
    title: `Nouvel envoi du formulaire « ${form.name} »`,
    body: `${leadName(lead)} a rempli le formulaire.`,
    path: `/leads/${lead._id}`,
  };
}

export async function renderDealAssigned(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const deal = live(await ctx.db.get(event.entity.id as Id<'deals'>));
  if (!deal) return null;
  return {
    recipients: assignedOf(event.data),
    visible: (vis) => moduleAllows(vis, 'deals', deal.ownerIds),
    title: `Transaction attribuée : ${deal.title}`,
    body: `${await actorName(ctx, event.actorId)} vous a attribué la transaction ${deal.title}.`,
    path: `/deals/${deal._id}`,
  };
}

/** The stage the fact names, not the one the deal is in now: it may have moved again since. */
async function stageLabel(
  ctx: Ctx,
  deal: Doc<'deals'>,
  data: NotificationEventData | undefined,
): Promise<string> {
  const stageKey = typeof data?.stageKey === 'string' ? data.stageKey : deal.stageKey;
  const pipeline = await ctx.db.get(deal.pipelineId);
  return (pipeline && pipelineStage(pipeline, stageKey)?.label) ?? stageKey;
}

export async function renderDealStageChanged(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const deal = live(await ctx.db.get(event.entity.id as Id<'deals'>));
  if (!deal) return null;
  const label = await stageLabel(ctx, deal, event.data);
  return {
    recipients: deal.ownerIds,
    visible: (vis) => moduleAllows(vis, 'deals', deal.ownerIds),
    title: `${deal.title} : ${label}`,
    body: `${await actorName(ctx, event.actorId)} a déplacé la transaction au stade « ${label} ».`,
    path: `/deals/${deal._id}`,
  };
}

export async function renderDealClosed(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const deal = live(await ctx.db.get(event.entity.id as Id<'deals'>));
  if (!deal) return null;
  // The outcome recorded with the fact: the deal may have been reopened since.
  const won = (event.data?.status ?? deal.status) === 'won';
  return {
    recipients: await teamMatesOf(ctx, deal.ownerIds),
    // A teammate whose role sees only their own deals is not told of this one.
    visible: (vis) => moduleAllows(vis, 'deals', deal.ownerIds),
    title: `Transaction ${won ? 'gagnée' : 'perdue'} : ${deal.title}`,
    body: `${await actorName(ctx, event.actorId)} a marqué la transaction ${won ? 'gagnée' : 'perdue'}.`,
    path: `/deals/${deal._id}`,
  };
}

export async function renderActivityAssigned(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const activity = live(await ctx.db.get(event.entity.id as Id<'activities'>));
  if (!activity) return null;
  return {
    recipients: assignedOf(event.data),
    visible: (vis) => vis.access.activities !== 'none',
    title: `Tâche attribuée : ${activity.title}`,
    body: `${await actorName(ctx, event.actorId)} vous a attribué la tâche ${activity.title}.`,
    path: '/tasks',
  };
}

export async function renderCampaignFinished(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const campaign = live(await ctx.db.get(event.entity.id as Id<'campaigns'>));
  if (!campaign?.createdBy) return null;
  const failed = campaign.status === 'failed';
  return {
    recipients: [campaign.createdBy],
    tellActor: true,
    visible: (vis) => moduleAllows(vis, 'campaigns', byCreator(campaign)),
    title: `Campagne ${failed ? 'en échec' : 'terminée'} : ${campaign.name}`,
    body: `${campaign.sentCount} envoi(s) réussi(s), ${campaign.failedCount} en échec.`,
    path: `/campaigns/${campaign._id}`,
  };
}

export async function renderWorkflowRunFailed(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const run = await ctx.db.get(event.entity.id as Id<'workflowRuns'>);
  const workflow = run ? await ctx.db.get(run.workflowId) : null;
  if (!run || !workflow) return null;
  const reason = typeof event.data?.reason === 'string' ? event.data.reason : '';
  return {
    recipients: await settingsUsers(ctx),
    visible: (vis) => moduleAllows(vis, 'workflows', byCreator(workflow)),
    title: `Échec du workflow « ${workflow.name} »`,
    body: reason ? `Une étape a échoué : ${reason}.` : 'Une étape a échoué.',
    path: `/workflows/${workflow._id}`,
  };
}

export async function renderImportFinished(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const job = await ctx.db.get(event.entity.id as Id<'importJobs'>);
  if (!job) return null;
  const { created, updated, errors } = job.counts;
  return {
    recipients: [job.createdBy],
    tellActor: true,
    title: `Import terminé : ${job.fileName}`,
    body: `${created} créé(s), ${updated} mis à jour, ${errors} en erreur.`,
    path: `/import/${job._id}`,
  };
}

export async function renderInvitationAccepted(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const email = typeof event.data?.email === 'string' ? event.data.email : '';
  const role = typeof event.data?.role === 'string' ? event.data.role : '';
  return {
    recipients: await settingsUsers(ctx),
    title: `${email || 'Une personne invitée'} a rejoint le CRM`,
    body: role ? `Avec le rôle « ${role} ».` : 'L’invitation a été acceptée.',
    path: '/settings/team',
  };
}
