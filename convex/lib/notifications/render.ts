import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { pipelineStage } from '../../_lib/validators/deals';
import type { NotificationEventData } from '../../_lib/validators/notifications';
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
}

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
    title: `Transaction attribuée : ${deal.title}`,
    body: `${await actorName(ctx, event.actorId)} vous a attribué la transaction ${deal.title}.`,
    path: `/deals/${deal._id}`,
  };
}

async function stageLabel(ctx: Ctx, deal: Doc<'deals'>): Promise<string> {
  const pipeline = await ctx.db.get(deal.pipelineId);
  return (pipeline && pipelineStage(pipeline, deal.stageKey)?.label) ?? deal.stageKey;
}

export async function renderDealStageChanged(
  ctx: Ctx,
  event: Doc<'notificationEvents'>,
): Promise<Rendered | null> {
  const deal = live(await ctx.db.get(event.entity.id as Id<'deals'>));
  if (!deal) return null;
  const label = await stageLabel(ctx, deal);
  return {
    recipients: deal.ownerIds,
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
  const won = deal.status === 'won';
  return {
    recipients: await teamMatesOf(ctx, deal.ownerIds),
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
