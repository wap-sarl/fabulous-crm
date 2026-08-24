import { beforeAll, describe, expect, test } from 'bun:test';
import type { FunctionArgs } from 'convex/server';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import {
  asIdentity,
  createTestConvex,
  seedEmployee,
  seedLead,
  type SeededEmployee,
  type T,
} from './helpers';

beforeAll(() => {
  // resolveEmailProvider/resolveBrevo fall back to env when appConfig is empty;
  // a Brevo key makes the email provider "configured" so createCampaign accepts.
  process.env.BREVO_API_KEY = 'test-brevo-key';
});

async function setup(): Promise<{ t: T; emp: SeededEmployee }> {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, emp };
}

type CampaignFilter = FunctionArgs<
  typeof internal.features.crm.internal.prepareCampaignBatch
>['filter'];

async function prepareCampaign(t: T, campaignId: Id<'campaigns'>, filter: CampaignFilter = {}) {
  let cursor: string | undefined;
  for (;;) {
    const res = await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
      campaignId,
      filter,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    if (res.isDone) return;
    cursor = res.continueCursor ?? undefined;
  }
}

/**
 * The consent gate for campaigns: the composer auto-seeds a
 * `marketingConsent contains <channel>` advanced-filter rule for marketing
 * sends; the same filter now drives the server-side recipient resolution.
 */
const emailConsentFilter = {
  advancedFilter: {
    combinator: 'and' as const,
    groups: [
      {
        combinator: 'and' as const,
        rules: [
          {
            field: { kind: 'standard' as const, field: 'marketingConsent' as const },
            operator: 'contains' as const,
            value: ['email'],
          },
        ],
      },
    ],
  },
};

describe('recipient resolution by consent (listMatchingLeadIds)', () => {
  test('the marketing consent rule excludes non-consenting leads', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const consenting = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Oui',
      lastName: 'Consent',
      email: 'oui@example.com',
    });
    const notConsenting = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Non',
      lastName: 'Consent',
      email: 'non@example.com',
    });
    const token = (await t.run((ctx) => ctx.db.get(consenting)))?.consentToken ?? '';
    await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token,
      channels: ['email'],
    });

    const result = await as.query(api.features.crm.queries.listMatchingLeadIds, emailConsentFilter);
    expect(result.leadIds).toContain(consenting);
    expect(result.leadIds).not.toContain(notConsenting);

    // Transactional sends use no consent rule: both leads match.
    const unfiltered = await as.query(api.features.crm.queries.listMatchingLeadIds, {});
    expect(unfiltered.leadIds).toContain(consenting);
    expect(unfiltered.leadIds).toContain(notConsenting);
  });
});

describe('createCampaign', () => {
  async function createLeads(t: T, emp: SeededEmployee): Promise<Id<'leads'>[]> {
    const as = asIdentity(t, emp.identity);
    const withEmail = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Avec',
      lastName: 'Email',
      email: 'avec@example.com',
    });
    const withoutEmail = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Sans',
      lastName: 'Email',
      email: '',
    });
    return [withEmail, withoutEmail];
  }

  test('prepares one send per recipient, skipping recipients without an email', async () => {
    const { t, emp } = await setup();
    const [withEmail, withoutEmail] = await createLeads(t, emp);
    const campaignId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createCampaign,
      {
        name: 'Newsletter test',
        channel: 'email',
        filter: {},
        subject: 'Bonjour',
        htmlBody: '<p>Contenu</p>',
      },
    );

    // Creation only stages the campaign; recipients arrive via the prep chain.
    let campaign = await t.run((ctx) => ctx.db.get(campaignId));
    expect(campaign?.status).toBe('preparing');
    expect(campaign?.totalCount).toBe(0);
    expect(await t.run((ctx) => ctx.db.query('campaignSends').collect())).toHaveLength(0);

    await prepareCampaign(t, campaignId);

    campaign = await t.run((ctx) => ctx.db.get(campaignId));
    expect(campaign?.totalCount).toBe(2);
    expect(campaign?.failedCount).toBe(1); // the no-email skip
    expect(campaign?.status).toBe('sending');
    expect(campaign?.recipientLeadIds).toBeUndefined();

    const sends = await t.run((ctx) => ctx.db.query('campaignSends').collect());
    expect(sends).toHaveLength(2);
    const byLead = new Map(sends.map((s) => [s.leadId, s]));
    expect(byLead.get(withEmail)?.status).toBe('pending');
    expect(byLead.get(withEmail)?.email).toBe('avec@example.com');
    expect(byLead.get(withoutEmail)?.status).toBe('skipped_no_email');
  });

  test('the campaign filter drives recipient resolution server-side', async () => {
    const { t, emp } = await setup();
    const as = asIdentity(t, emp.identity);
    const consenting = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Oui',
      lastName: 'Consent',
      email: 'oui@example.com',
    });
    const notConsenting = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Non',
      lastName: 'Consent',
      email: 'non@example.com',
    });
    const token = (await t.run((ctx) => ctx.db.get(consenting)))?.consentToken ?? '';
    await t.mutation(api.features.crm.mutations.updateConsentByToken, {
      token,
      channels: ['email'],
    });

    const campaignId = await as.mutation(api.features.crm.mutations.createCampaign, {
      name: 'Marketing filtrée',
      channel: 'email',
      filter: emailConsentFilter,
      subject: 'Bonjour',
      htmlBody: '<p>Contenu</p>',
    });
    await prepareCampaign(t, campaignId, emailConsentFilter);

    const sends = await t.run((ctx) => ctx.db.query('campaignSends').collect());
    expect(sends).toHaveLength(1);
    expect(sends[0]?.leadId).toBe(consenting);
    expect(sends.map((s) => s.leadId)).not.toContain(notConsenting);
  });

  test('preparation spans multiple batches beyond the page size', async () => {
    const { t, emp } = await setup();
    // PREP_BATCH is 200 — 205 leads forces at least two pages.
    for (let i = 0; i < 205; i++) {
      await seedLead(t, { email: `bulk-${i}@example.com` });
    }
    const campaignId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createCampaign,
      {
        name: 'Grosse campagne',
        channel: 'email',
        filter: {},
        subject: 'Bonjour',
        htmlBody: '<p>Contenu</p>',
      },
    );
    await prepareCampaign(t, campaignId);

    const campaign = await t.run((ctx) => ctx.db.get(campaignId));
    expect(campaign?.totalCount).toBe(205);
    expect(campaign?.failedCount).toBe(0);
    expect(campaign?.status).toBe('sending');
    const sends = await t.run((ctx) => ctx.db.query('campaignSends').collect());
    expect(sends).toHaveLength(205);
    expect(sends.every((s) => s.status === 'pending')).toBe(true);
  });

  test('a campaign deleted mid-preparation stops the chain without new sends', async () => {
    const { t, emp } = await setup();
    await seedLead(t, { email: 'a@example.com' });
    const campaignId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createCampaign,
      {
        name: 'Annulée',
        channel: 'email',
        filter: {},
        subject: 'Bonjour',
        htmlBody: '<p>Contenu</p>',
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(campaignId, { deletedAt: Date.now() });
    });

    const res = await t.mutation(internal.features.crm.internal.prepareCampaignBatch, {
      campaignId,
      filter: {},
    });
    expect(res.isDone).toBe(true);
    expect(await t.run((ctx) => ctx.db.query('campaignSends').collect())).toHaveLength(0);
    const campaign = await t.run((ctx) => ctx.db.get(campaignId));
    expect(campaign?.status).toBe('preparing'); // untouched, just abandoned
  });

  test('rejects an empty name and an invalid Brevo template id', async () => {
    const { t, emp } = await setup();
    await createLeads(t, emp);
    const as = asIdentity(t, emp.identity);
    await expect(
      as.mutation(api.features.crm.mutations.createCampaign, {
        name: '   ',
        channel: 'email',
        filter: {},
        subject: 'S',
        htmlBody: '<p>x</p>',
      }),
    ).rejects.toThrow('Le nom de la campagne est requis.');
    await expect(
      as.mutation(api.features.crm.mutations.createCampaign, {
        name: 'Template',
        channel: 'email',
        filter: {},
        brevoTemplateId: -1,
      }),
    ).rejects.toThrow('ID de template Brevo invalide.');
  });

  test('a custom email without a subject is rejected', async () => {
    const { t, emp } = await setup();
    await createLeads(t, emp);
    await expect(
      asIdentity(t, emp.identity).mutation(api.features.crm.mutations.createCampaign, {
        name: 'Sans objet',
        channel: 'email',
        filter: {},
        htmlBody: '<p>x</p>',
      }),
    ).rejects.toThrow('L’objet de l’e-mail est requis.');
  });
});
