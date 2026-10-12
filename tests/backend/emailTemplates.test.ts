import { beforeAll, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, pinClock, seedConfig, seedEmployee } from './helpers';

const NOW = Date.parse('2026-10-13T10:00:00Z');

beforeAll(() => {
  process.env.BREVO_API_KEY = 'test-brevo-key';
});

type As = ReturnType<typeof asIdentity>;

/** An admin, two members of one team, a member of another: the reaches a scope tells apart. */
async function setup() {
  const t = createTestConvex();
  pinClock(NOW);
  await seedConfig(t);
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const nina = await seedEmployee(t, { email: 'nina@example.com', role: 'member' });
  const marc = await seedEmployee(t, { email: 'marc@example.com', role: 'member' });
  const sam = await seedEmployee(t, { email: 'sam@example.com', role: 'member' });
  const as = {
    admin: asIdentity(t, admin.identity),
    nina: asIdentity(t, nina.identity),
    marc: asIdentity(t, marc.identity),
    sam: asIdentity(t, sam.identity),
  };
  await as.admin.mutation(api.features.teams.mutations.createTeam, {
    name: 'Nord',
    memberIds: [nina.userId, marc.userId],
  });
  await as.admin.mutation(api.features.teams.mutations.createTeam, {
    name: 'Sud',
    memberIds: [sam.userId],
  });
  return { t, as, admin, nina, marc, sam };
}

const template = (as: As, name: string, scope: 'private' | 'team' | 'organization') =>
  as.mutation(api.features.emailTemplates.mutations.createEmailTemplate, {
    name,
    subject: `Objet ${name}`,
    htmlBody: `<p>Bonjour {{ params.firstName }}, ${name}</p>`,
    category: 'Suivi',
    scope,
  });

const names = async (as: As) =>
  (await as.query(api.features.emailTemplates.queries.listEmailTemplates, {}))
    .map((row) => row.name)
    .sort();

describe('email templates', () => {
  test('the wizard seeds three templates for the organisation, owned by its first administrator; ensureDefaults adds nothing once any exists', async () => {
    const t = createTestConvex();
    process.env.SETUP_TOKEN = 'setup-token';
    await t.mutation(api.setup.mutations.completeSetup, {
      setupToken: 'setup-token',
      organizationName: 'Acme',
      appUrl: 'https://crm.acme.example.com',
      senderEmail: 'crm@acme.example.com',
      senderName: 'Acme',
      auth: { magicLinkEnabled: true, ssoProviders: [] },
      admin: { email: 'admin@acme.example.com', firstName: 'Ada', lastName: 'Admin' },
    });
    const rows = await t.run((ctx) => ctx.db.query('emailTemplates').collect());
    const admin = await t.run((ctx) => ctx.db.query('users').first());
    expect(rows.map((r) => [r.name, r.category, r.scope, r.ownerId])).toEqual([
      ['Bienvenue', 'Accueil', 'organization', admin?._id],
      ['Relance', 'Suivi', 'organization', admin?._id],
      ['Invitation', 'Événements', 'organization', admin?._id],
    ]);
    expect(rows.every((r) => r.htmlBody.includes('{{ params.firstName }}'))).toBe(true);

    const { as } = await setup();
    await template(as.nina, 'Mien', 'private');
    expect(await as.admin.mutation(api.features.emailTemplates.mutations.ensureDefaults, {})).toBe(
      0,
    );
  });

  test('a private template is its owner’s, a team one its teammates’ too, an organisation one everyone’s; full access reads all', async () => {
    const { as } = await setup();
    await template(as.nina, 'Privé', 'private');
    await template(as.nina, 'Équipe', 'team');
    await template(as.nina, 'Tous', 'organization');
    expect(await names(as.nina)).toEqual(['Privé', 'Tous', 'Équipe'].sort());
    expect(await names(as.marc)).toEqual(['Tous', 'Équipe'].sort());
    expect(await names(as.sam)).toEqual(['Tous']);
    expect(await names(as.admin)).toEqual(['Privé', 'Tous', 'Équipe'].sort());
    // Who may change what: the owner, or the settings right; the others see it read-only or not at all.
    const marcSees = await as.marc.query(
      api.features.emailTemplates.queries.listEmailTemplates,
      {},
    );
    expect(marcSees.map((r) => [r.name, r.editable]).sort()).toEqual([
      ['Tous', false],
      ['Équipe', false],
    ]);
    const adminSees = await as.admin.query(
      api.features.emailTemplates.queries.listEmailTemplates,
      {},
    );
    expect(adminSees.every((r) => r.editable)).toBe(true);
  });

  test('the owner or the settings right edits and deletes; a copy is the copier’s own, private; a deleted template leaves the list', async () => {
    const { t, as } = await setup();
    const teamId = await template(as.nina, 'Équipe', 'team');
    const edit = (as: As, name: string) =>
      as.mutation(api.features.emailTemplates.mutations.updateEmailTemplate, {
        templateId: teamId,
        name,
        subject: 'Objet',
        htmlBody: '<p>Corps</p>',
        scope: 'team',
      });
    await expect(edit(as.marc, 'Volé')).rejects.toMatchObject({
      data: { code: 'template_forbidden' },
    });
    await expect(edit(as.sam, 'Invisible')).rejects.toMatchObject({
      data: { code: 'template_not_found' },
    });
    await edit(as.admin, 'Revu');
    await edit(as.nina, 'Équipe bis');
    expect((await t.run((ctx) => ctx.db.get(teamId)))?.name).toBe('Équipe bis');

    const copyId = await as.marc.mutation(
      api.features.emailTemplates.mutations.duplicateEmailTemplate,
      { templateId: teamId },
    );
    const copy = await t.run((ctx) => ctx.db.get(copyId));
    expect(copy).toMatchObject({ name: 'Équipe bis (copie)', scope: 'private', subject: 'Objet' });
    expect(await names(as.nina)).toEqual(['Équipe bis']);

    await expect(
      as.marc.mutation(api.features.emailTemplates.mutations.deleteEmailTemplate, {
        templateId: teamId,
      }),
    ).rejects.toMatchObject({ data: { code: 'template_forbidden' } });
    await as.nina.mutation(api.features.emailTemplates.mutations.deleteEmailTemplate, {
      templateId: teamId,
    });
    expect(await names(as.marc)).toEqual(['Équipe bis (copie)']);
    expect((await t.run((ctx) => ctx.db.get(teamId)))?.deletedAt).toBe(NOW);
    const audits = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'emailTemplate').eq('entityId', teamId))
        .collect(),
    );
    expect(audits.map((a) => a.action)).toEqual(['create', 'update', 'update', 'delete']);
  });

  test('each field within its bounds', async () => {
    const { as } = await setup();
    const create = (extra: Record<string, unknown>) =>
      as.nina.mutation(api.features.emailTemplates.mutations.createEmailTemplate, {
        name: 'Ok',
        subject: 'Objet',
        htmlBody: '<p>Corps</p>',
        scope: 'private',
        ...extra,
      });
    await expect(create({ name: ' ' })).rejects.toMatchObject({
      data: { code: 'template_name_invalid' },
    });
    await expect(create({ subject: 'x'.repeat(201) })).rejects.toMatchObject({
      data: { code: 'template_subject_invalid' },
    });
    await expect(create({ htmlBody: '<p></p>' })).rejects.toMatchObject({
      data: { code: 'template_body_invalid' },
    });
    await expect(create({ category: 'x'.repeat(41) })).rejects.toMatchObject({
      data: { code: 'template_category_invalid' },
    });
    const id = await create({ name: '  Espaces  ', category: '  ' });
    const row = await as.nina.query(api.features.emailTemplates.queries.listEmailTemplates, {});
    expect(row.find((r) => r._id === id)).toMatchObject({ name: 'Espaces' });
    expect(row.find((r) => r._id === id)?.category).toBeUndefined();
  });

  test('a campaign and a workflow step loaded from a template count towards it, with the campaign’s sends, opens and clicks', async () => {
    const { t, as, nina } = await setup();
    const templateId = await template(as.nina, 'Relance', 'team');
    const otherId = await template(as.nina, 'Autre', 'private');
    const leadIds: Id<'leads'>[] = [];
    for (const email of ['a@example.com', 'b@example.com']) {
      leadIds.push(
        await as.nina.mutation(api.features.leads.mutations.createLead, {
          firstName: 'L',
          lastName: email,
          email,
          ownerIds: [nina.userId],
        }),
      );
    }
    // A template out of reach cannot be named.
    await expect(
      as.sam.mutation(api.features.campaigns.mutations.createCampaign, {
        name: 'Volée',
        channel: 'email',
        filter: {},
        subject: 'Objet',
        htmlBody: '<p>Corps</p>',
        messageType: 'transactional',
        templateId,
      }),
    ).rejects.toMatchObject({ data: { code: 'template_not_found' } });
    const campaignId = await as.nina.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Relance d’octobre',
      channel: 'email',
      filter: {},
      subject: 'Objet',
      htmlBody: '<p>Corps</p>',
      messageType: 'transactional',
      templateId,
    });
    await t.mutation(internal.features.campaigns.internal.prepareCampaignBatch, {
      campaignId,
      filter: {},
    });
    const sends = await t.run((ctx) =>
      ctx.db
        .query('campaignSends')
        .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
        .collect(),
    );
    expect(sends).toHaveLength(2);
    await t.mutation(internal.features.campaigns.internal.recordSendResults, {
      campaignId,
      results: sends.map((send, i) => ({
        sendId: send._id,
        status: 'sent' as const,
        brevoMessageId: `m-${i}`,
      })),
    });
    await t.mutation(internal.features.campaigns.internal.recordBrevoEmailEvent, {
      brevoMessageId: 'm-0',
      type: 'opened',
      eventAt: NOW + 1,
    });
    await t.mutation(internal.features.campaigns.internal.recordBrevoEmailEvent, {
      brevoMessageId: 'm-0',
      type: 'clicked',
      eventAt: NOW + 2,
      url: 'https://example.com',
    });

    const node = (templateId?: Id<'emailTemplates'>) => ({
      id: 'n1',
      type: 'send_email' as const,
      subject: 'Objet',
      htmlBody: '<p>Corps</p>',
      templateId,
    });
    await expect(
      as.sam.mutation(api.features.workflows.mutations.createWorkflow, {
        name: 'Volé',
        trigger: { type: 'lead_created' },
        allowReEnrollment: false,
        nodes: [node(templateId)],
        startNodeId: 'n1',
      }),
    ).rejects.toMatchObject({ data: { code: 'template_not_found' } });
    const workflowId = await as.marc.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Bienvenue',
      trigger: { type: 'lead_created' },
      allowReEnrollment: false,
      nodes: [node(templateId)],
      startNodeId: 'n1',
    });

    const usage = (as: As, id: Id<'emailTemplates'>) =>
      as.query(api.features.emailTemplates.queries.getEmailTemplateUsage, { templateId: id });
    // The figures are read through the caller's reach: the admin sees the campaign and the workflow, Nina her campaign only, Marc's workflow being his.
    expect(await usage(as.admin, templateId)).toEqual({
      campaigns: 1,
      workflows: 1,
      sent: 2,
      opened: 1,
      clicked: 1,
      partial: false,
    });
    expect(await usage(as.nina, templateId)).toMatchObject({ campaigns: 1, workflows: 0, sent: 2 });
    expect(await usage(as.admin, otherId)).toMatchObject({ campaigns: 0, workflows: 0, sent: 0 });
    // The step loaded another template: the first one loses it.
    await as.marc.mutation(api.features.workflows.mutations.updateWorkflow, {
      workflowId,
      name: 'Bienvenue',
      trigger: { type: 'lead_created' },
      allowReEnrollment: false,
      nodes: [node()],
      startNodeId: 'n1',
    });
    expect((await usage(as.admin, templateId)).workflows).toBe(0);
    // The campaign keeps its copy and its figures count whatever becomes of the template.
    expect((await t.run((ctx) => ctx.db.get(campaignId)))?.templateId).toBe(templateId);
  });
});

describe('snippets', () => {
  test('a shortcut is slash-lowercase and names one snippet; the fields are bounded; the list is by shortcut', async () => {
    const { t, as } = await setup();
    const create = (extra: Record<string, unknown>) =>
      as.nina.mutation(api.features.snippets.mutations.createSnippet, {
        name: 'Signature',
        shortcut: '/signature',
        text: 'Cordialement,\nL’équipe',
        ...extra,
      });
    await expect(create({ shortcut: 'signature' })).rejects.toMatchObject({
      data: { code: 'snippet_shortcut_invalid' },
    });
    await expect(create({ shortcut: '/Sig nature' })).rejects.toMatchObject({
      data: { code: 'snippet_shortcut_invalid' },
    });
    await expect(create({ text: ' ' })).rejects.toMatchObject({
      data: { code: 'snippet_text_invalid' },
    });
    await expect(create({ name: '' })).rejects.toMatchObject({
      data: { code: 'snippet_name_invalid' },
    });
    const signatureId = await create({});
    await expect(create({ name: 'Autre' })).rejects.toMatchObject({
      data: { code: 'snippet_shortcut_taken' },
    });
    const devisId = await create({ name: 'Devis', shortcut: '/devis', text: 'Voici notre devis.' });
    await expect(
      as.marc.mutation(api.features.snippets.mutations.updateSnippet, {
        snippetId: devisId,
        name: 'Devis',
        shortcut: '/signature',
        text: 'x',
      }),
    ).rejects.toMatchObject({ data: { code: 'snippet_shortcut_taken' } });
    await as.marc.mutation(api.features.snippets.mutations.updateSnippet, {
      snippetId: devisId,
      name: 'Devis',
      shortcut: '/devis',
      text: 'Voici notre devis, valable un mois.',
    });
    // Every employee reads them all, by shortcut.
    expect(
      (await as.sam.query(api.features.snippets.queries.listSnippets, {})).map((s) => s.shortcut),
    ).toEqual(['/devis', '/signature']);
    await as.sam.mutation(api.features.snippets.mutations.deleteSnippet, {
      snippetId: signatureId,
    });
    expect(await t.run((ctx) => ctx.db.get(signatureId))).toBeNull();
    await expect(
      as.sam.mutation(api.features.snippets.mutations.deleteSnippet, { snippetId: signatureId }),
    ).rejects.toMatchObject({ data: { code: 'snippet_not_found' } });
  });
});
