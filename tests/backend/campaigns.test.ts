import { beforeAll, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, seedEmployee, type SeededEmployee, type T } from './helpers';

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

/**
 * The consent gate for campaigns: the composer auto-seeds a
 * `marketingConsent contains <channel>` advanced-filter rule for marketing
 * sends, and the server resolves recipients through `listMatchingLeadIds`.
 */
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

    // The exact rule shape the composer seeds for a marketing email campaign.
    const result = await as.query(api.features.crm.queries.listMatchingLeadIds, {
      advancedFilter: {
        combinator: 'and',
        groups: [
          {
            combinator: 'and',
            rules: [
              {
                field: { kind: 'standard', field: 'marketingConsent' },
                operator: 'contains',
                value: ['email'],
              },
            ],
          },
        ],
      },
    });
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

  test('creates one send per recipient, skipping recipients without an email', async () => {
    const { t, emp } = await setup();
    const [withEmail, withoutEmail] = await createLeads(t, emp);
    const campaignId = await asIdentity(t, emp.identity).mutation(
      api.features.crm.mutations.createCampaign,
      {
        name: 'Newsletter test',
        channel: 'email',
        // Duplicate id → must be deduplicated.
        leadIds: [withEmail, withoutEmail, withEmail],
        subject: 'Bonjour',
        htmlBody: '<p>Contenu</p>',
      },
    );

    const campaign = await t.run((ctx) => ctx.db.get(campaignId));
    expect(campaign?.totalCount).toBe(2);
    expect(campaign?.failedCount).toBe(1); // the no-email skip
    expect(campaign?.status).toBe('sending');

    const sends = await t.run((ctx) => ctx.db.query('campaignSends').collect());
    expect(sends).toHaveLength(2);
    const byLead = new Map(sends.map((s) => [s.leadId, s]));
    expect(byLead.get(withEmail)?.status).toBe('pending');
    expect(byLead.get(withEmail)?.email).toBe('avec@example.com');
    expect(byLead.get(withoutEmail)?.status).toBe('skipped_no_email');
  });

  test('rejects an empty name and an invalid Brevo template id', async () => {
    const { t, emp } = await setup();
    const [withEmail] = await createLeads(t, emp);
    const as = asIdentity(t, emp.identity);
    await expect(
      as.mutation(api.features.crm.mutations.createCampaign, {
        name: '   ',
        channel: 'email',
        leadIds: [withEmail],
        subject: 'S',
        htmlBody: '<p>x</p>',
      }),
    ).rejects.toThrow('Le nom de la campagne est requis.');
    await expect(
      as.mutation(api.features.crm.mutations.createCampaign, {
        name: 'Template',
        channel: 'email',
        leadIds: [withEmail],
        brevoTemplateId: -1,
      }),
    ).rejects.toThrow('ID de template Brevo invalide.');
  });

  test('a custom email without a subject is rejected', async () => {
    const { t, emp } = await setup();
    const [withEmail] = await createLeads(t, emp);
    await expect(
      asIdentity(t, emp.identity).mutation(api.features.crm.mutations.createCampaign, {
        name: 'Sans objet',
        channel: 'email',
        leadIds: [withEmail],
        htmlBody: '<p>x</p>',
      }),
    ).rejects.toThrow('L’objet de l’e-mail est requis.');
  });
});
