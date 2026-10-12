import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { FormFieldInput, FormStandardField } from '../../convex/_lib/validators/forms';
import { matchesTrigger } from '../../convex/lib/workflows/rules';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runAll,
  seedConfig,
  seedEmployee,
  setConsentChannels,
  type T,
} from './helpers';

const NOW = Date.parse('2026-10-12T10:00:00Z');
const TOKEN = 'setup-token';
const IP = { 'x-forwarded-for': '203.0.113.7', 'Content-Type': 'application/json' };

let savedToken: string | undefined;
beforeEach(() => {
  savedToken = process.env.SETUP_TOKEN;
  process.env.SETUP_TOKEN = TOKEN;
});
afterEach(() => {
  setSystemTime();
  if (savedToken === undefined) delete process.env.SETUP_TOKEN;
  else process.env.SETUP_TOKEN = savedToken;
});

type As = ReturnType<typeof asIdentity>;
type Types = Record<'newsletter' | 'product' | 'invitations', Id<'subscriptionTypes'>>;

/** An admin, the shipped types by name, and a contact who consented to e-mail. */
async function setup(): Promise<{
  t: T;
  as: As;
  types: Types;
  leadId: Id<'leads'>;
  token: string;
}> {
  // The route hashes the address with a key derived from the auth secret; the campaigns need a provider.
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  process.env.BREVO_API_KEY = 'test-brevo-key';
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await seedConfig(t);
  await as.mutation(api.features.subscriptions.mutations.ensureDefaults, {});
  const rows = await as.query(api.features.subscriptions.queries.listSubscriptionTypes, {});
  const byName = (name: string) =>
    rows.find((r) => r.name === name)?._id as Id<'subscriptionTypes'>;
  const types = {
    newsletter: byName('Newsletter'),
    product: byName('Informations produit'),
    invitations: byName('Invitations'),
  };
  const leadId = await as.mutation(api.features.leads.mutations.createLead, {
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
  });
  const token = (await t.run((ctx) => ctx.db.get(leadId)))?.consentToken ?? '';
  await setConsentChannels(t, leadId, ['email']);
  return { t, as, types, leadId, token };
}

const post = (t: T, token: string, body: unknown, headers: Record<string, string> = IP) =>
  t.fetch(`/consent/${token}`, { method: 'POST', headers, body: JSON.stringify(body) });

const eventsOf = (t: T, leadId: Id<'leads'>) =>
  t.run((ctx) =>
    ctx.db
      .query('consentEvents')
      .withIndex('by_lead', (q) => q.eq('leadId', leadId))
      .collect(),
  );

const standing = (t: T, token: string) =>
  t.query(api.features.consent.queries.getConsentByToken, { token });

describe('subscription types', () => {
  test('the wizard seeds the three shipped types in order, and ensureDefaults adds nothing once any exists', async () => {
    const t = createTestConvex();
    await t.mutation(api.setup.mutations.completeSetup, {
      setupToken: TOKEN,
      organizationName: 'Acme',
      appUrl: 'https://crm.acme.example.com',
      senderEmail: 'crm@acme.example.com',
      senderName: 'Acme',
      auth: { magicLinkEnabled: true, ssoProviders: [] },
      admin: { email: 'admin@acme.example.com', firstName: 'Ada', lastName: 'Admin' },
    });
    const rows = await t.run((ctx) => ctx.db.query('subscriptionTypes').collect());
    expect(rows.map((r) => [r.name, r.channel, r.legalBasis, r.active, r.order])).toEqual([
      ['Newsletter', 'email', 'consent', true, 0],
      ['Informations produit', 'email', 'consent', true, 1],
      ['Invitations', 'email', 'consent', true, 2],
    ]);

    const { as } = await setup();
    expect(await as.mutation(api.features.subscriptions.mutations.ensureDefaults, {})).toBe(0);
  });

  test('a type is named within bounds, keeps its channel and basis, is reordered as a whole list, and goes on delete', async () => {
    const { t, as, types } = await setup();
    const create = (name: string) =>
      as.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
        name,
        channel: 'sms',
        legalBasis: 'consent',
        active: true,
      });
    await expect(create('  ')).rejects.toMatchObject({
      data: { code: 'subscription_name_invalid' },
    });
    await expect(create('x'.repeat(81))).rejects.toMatchObject({
      data: { code: 'subscription_name_invalid' },
    });
    const smsId = await create('  Alertes SMS  ');
    const sms = await t.run((ctx) => ctx.db.get(smsId));
    expect(sms).toMatchObject({ name: 'Alertes SMS', channel: 'sms', order: 3 });

    await as.mutation(api.features.subscriptions.mutations.updateSubscriptionType, {
      typeId: smsId,
      name: 'Alertes',
      description: 'x'.repeat(500),
      active: false,
    });
    expect(await t.run((ctx) => ctx.db.get(smsId))).toMatchObject({
      name: 'Alertes',
      active: false,
      channel: 'sms',
    });
    await expect(
      as.mutation(api.features.subscriptions.mutations.updateSubscriptionType, {
        typeId: smsId,
        description: 'x'.repeat(501),
      }),
    ).rejects.toMatchObject({ data: { code: 'subscription_description_invalid' } });

    await expect(
      as.mutation(api.features.subscriptions.mutations.reorderSubscriptionTypes, {
        typeIds: [smsId, types.newsletter],
      }),
    ).rejects.toMatchObject({ data: { code: 'invalid_subscription_order' } });
    await as.mutation(api.features.subscriptions.mutations.reorderSubscriptionTypes, {
      typeIds: [smsId, types.invitations, types.product, types.newsletter],
    });
    const ordered = await as.query(api.features.subscriptions.queries.listSubscriptionTypes, {});
    expect(ordered.map((r) => r.name)).toEqual([
      'Alertes',
      'Invitations',
      'Informations produit',
      'Newsletter',
    ]);

    await as.mutation(api.features.subscriptions.mutations.deleteSubscriptionType, {
      typeId: smsId,
    });
    expect(await t.run((ctx) => ctx.db.get(smsId))).toBeNull();
    const audits = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) => q.eq('entityType', 'subscriptionType').eq('entityId', smsId))
        .collect(),
    );
    expect(audits.map((a) => a.action)).toEqual(['create', 'update', 'delete']);
  });

  test('a member sees the types and changes none of them', async () => {
    const { t } = await setup();
    const member = await seedEmployee(t, { email: 'member@example.com' });
    const asMember = asIdentity(t, member.identity);
    expect(
      await asMember.query(api.features.subscriptions.queries.listSubscriptionTypes, {}),
    ).toHaveLength(3);
    await expect(
      asMember.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
        name: 'X',
        channel: 'email',
        legalBasis: 'consent',
        active: true,
      }),
    ).rejects.toThrow();
  });
});

describe('where a contact stands', () => {
  test('nothing without the channel; with it, a consent type needs their word and a legitimate-interest type is in until they object', async () => {
    const { t, as, types, token } = await setup();
    // Ada holds e-mail and chose nothing: a consent is given per topic, so she is in on none.
    expect((await standing(t, token))?.types.map((x) => x.subscribed)).toEqual([
      false,
      false,
      false,
    ]);
    const liId = await as.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
      name: 'Clients',
      channel: 'email',
      legalBasis: 'legitimate_interest',
      active: true,
    });
    const standingOn = async (id: string, who = token) =>
      (await standing(t, who))?.types.find((x) => x._id === id)?.subscribed;
    expect(await standingOn(liId)).toBe(true);
    await post(t, token, { types: { [liId]: false } });
    expect(await standingOn(liId)).toBe(false);

    // Bob never consented to e-mail (an employee created him): out of everything, the legitimate interest included.
    const bobId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'Martin',
      email: 'bob@example.com',
    });
    const bobToken = (await t.run((ctx) => ctx.db.get(bobId)))?.consentToken ?? '';
    const bob = await standing(t, bobToken);
    expect(bob?.types.map((x) => [x.name, x.subscribed])).toEqual([
      ['Newsletter', false],
      ['Informations produit', false],
      ['Invitations', false],
      ['Clients', false],
    ]);
    // Carol withdrew e-mail before any type existed: out of them all, and of a legitimate-interest type made later.
    const carolId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Carol',
      lastName: 'Martin',
      email: 'carol@example.com',
    });
    const carolToken = (await t.run((ctx) => ctx.db.get(carolId)))?.consentToken ?? '';
    await setConsentChannels(t, carolId, ['email']);
    await post(t, carolToken, { types: { [types.newsletter]: true } });
    await setConsentChannels(t, carolId, []);
    const laterId = await as.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
      name: 'Partenaires',
      channel: 'email',
      legalBasis: 'legitimate_interest',
      active: true,
    });
    expect((await standing(t, carolToken))?.types.map((x) => x.subscribed)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(await standingOn(laterId, carolToken)).toBe(false);
    // An inactive type is not proposed.
    await as.mutation(api.features.subscriptions.mutations.updateSubscriptionType, {
      typeId: types.newsletter,
      active: false,
    });
    expect((await standing(t, token))?.types.map((x) => x.name)).toEqual([
      'Informations produit',
      'Invitations',
      'Clients',
      'Partenaires',
    ]);
  });
});

describe('the preference centre', () => {
  test('a contact leaves the newsletter and keeps the invitations: a newsletter campaign skips them, an invitation campaign reaches them, the timeline shows both choices with their source', async () => {
    const { t, as, types, leadId, token } = await setup();
    await post(t, token, { types: { [types.newsletter]: true, [types.invitations]: true } });
    const response = await post(t, token, {
      types: { [types.newsletter]: false, [types.invitations]: true },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const lead = await t.run((ctx) => ctx.db.get(leadId));
    expect(lead?.marketingConsent).toEqual(['email']);
    expect(lead?.consentSource).toBe('preference_center');
    expect(lead?.subscriptions).toEqual([
      { typeId: types.newsletter, status: 'out', source: 'preference_center', at: NOW },
      { typeId: types.invitations, status: 'in', source: 'preference_center', at: NOW },
    ]);
    // The channel first, the two topics chosen, then the one left; the invitations confirmed are no change.
    const events = await eventsOf(t, leadId);
    expect(events.map((e) => [e.typeId, e.channel, e.from, e.to, e.source])).toEqual([
      [undefined, 'email', 'out', 'in', 'public_link'],
      [types.newsletter, undefined, 'out', 'in', 'preference_center'],
      [types.invitations, undefined, 'out', 'in', 'preference_center'],
      [types.newsletter, undefined, 'in', 'out', 'preference_center'],
    ]);
    expect(events[0].ipHash).toBeUndefined();
    expect(events[3].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await standing(t, token))?.types.map((x) => x.subscribed)).toEqual([
      false,
      false,
      true,
    ]);

    const campaignOn = async (subscriptionTypeId: Id<'subscriptionTypes'>) => {
      const campaignId = await as.mutation(api.features.campaigns.mutations.createCampaign, {
        name: 'C',
        channel: 'email',
        filter: {},
        subject: 'Objet',
        htmlBody: '<p>Bonjour {{ params.consentUrl }}</p>',
        subscriptionTypeId,
      });
      await t.mutation(internal.features.campaigns.internal.prepareCampaignBatch, {
        campaignId,
        filter: {},
      });
      return t.run((ctx) =>
        ctx.db
          .query('campaignSends')
          .withIndex('by_campaign', (q) => q.eq('campaignId', campaignId))
          .collect(),
      );
    };
    expect(await campaignOn(types.newsletter)).toHaveLength(0);
    expect(await campaignOn(types.invitations)).toMatchObject([{ leadId, status: 'pending' }]);
    // A type never chosen reaches nobody, the channel's consent notwithstanding.
    expect(await campaignOn(types.product)).toHaveLength(0);

    const page = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId,
      kinds: ['consent'],
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toMatchObject([
      {
        kind: 'consent',
        typeName: 'Newsletter',
        to: 'out',
        source: 'preference_center',
        fromAddress: true,
      },
      { kind: 'consent', typeName: 'Invitations', to: 'in', source: 'preference_center' },
      { kind: 'consent', typeName: 'Newsletter', to: 'in', source: 'preference_center' },
      { kind: 'consent', typeName: null, channel: 'email', to: 'in', source: 'public_link' },
    ]);
  });

  test('a campaign names an active type of its own channel, and a transactional one names none', async () => {
    const { t, as, types } = await setup();
    const create = (extra: Record<string, unknown>) =>
      as.mutation(api.features.campaigns.mutations.createCampaign, {
        name: 'C',
        channel: 'email',
        filter: {},
        subject: 'Objet',
        htmlBody: '<p>Bonjour</p>',
        ...extra,
      });
    await as.mutation(api.features.subscriptions.mutations.updateSubscriptionType, {
      typeId: types.product,
      active: false,
    });
    await expect(create({ subscriptionTypeId: types.product })).rejects.toMatchObject({
      data: { code: 'subscription_type_not_found' },
    });
    const smsId = await as.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
      name: 'Alertes',
      channel: 'sms',
      legalBasis: 'consent',
      active: true,
    });
    await expect(create({ subscriptionTypeId: smsId })).rejects.toMatchObject({
      data: { code: 'subscription_channel_mismatch' },
    });
    const campaignId = await create({
      subscriptionTypeId: types.newsletter,
      messageType: 'transactional',
    });
    expect((await t.run((ctx) => ctx.db.get(campaignId)))?.subscriptionTypeId).toBeUndefined();
  });

  test('a channel refused takes each of its types with it; a type joined brings its channel; « tout désinscrire » leaves nothing', async () => {
    const { t, as, types, leadId, token } = await setup();
    const smsId = await as.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
      name: 'Alertes SMS',
      channel: 'sms',
      legalBasis: 'legitimate_interest',
      active: true,
    });
    // Joining the SMS alerts opts the contact into SMS.
    expect((await post(t, token, { types: { [smsId]: true } })).status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.marketingConsent).toEqual(['email', 'sms']);
    // Refusing SMS as a channel objects to the alerts too, legitimate interest or not.
    await setConsentChannels(t, leadId, ['email']);
    const after = await t.run((ctx) => ctx.db.get(leadId));
    expect(after?.marketingConsent).toEqual(['email']);
    expect(after?.subscriptions).toMatchObject([{ typeId: smsId, status: 'out' }]);
    expect((await standing(t, token))?.types.find((x) => x._id === smsId)?.subscribed).toBe(false);
    // An objection stands when the channel comes back.
    await setConsentChannels(t, leadId, ['email', 'sms']);
    expect((await standing(t, token))?.types.find((x) => x._id === smsId)?.subscribed).toBe(false);

    await post(t, token, { types: { [types.newsletter]: true } });
    expect((await post(t, token, { unsubscribeAll: true })).status).toBe(200);
    const gone = await t.run((ctx) => ctx.db.get(leadId));
    expect(gone?.marketingConsent).toEqual([]);
    expect(gone?.subscriptions?.map((s) => s.status)).toEqual(['out', 'out', 'out', 'out']);
    expect((await standing(t, token))?.types.map((x) => x.subscribed)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    const events = await eventsOf(t, leadId);
    const last = events.slice(-3);
    const key = (e: { channel?: string; typeId?: string; to: string }) =>
      `${e.channel ?? e.typeId}:${e.to}`;
    expect(last.map(key).sort()).toEqual(
      ['email:out', 'sms:out', `${types.newsletter}:out`].sort(),
    );

    // The same choice saved again, or a choice that confirms where one stands, changes nothing: no event, no workflow.
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Consentement',
      trigger: { type: 'consent_updated' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    const count = events.length;
    expect((await post(t, token, { unsubscribeAll: true })).status).toBe(200);
    expect((await post(t, token, { types: { [types.product]: false } })).status).toBe(200);
    expect(await eventsOf(t, leadId)).toHaveLength(count);
    expect(await t.run((ctx) => ctx.db.query('workflowRuns').collect())).toEqual([]);
  });

  test('the trigger « consentement mis à jour » can name one type', () => {
    const typeId = 'k57abc' as Id<'subscriptionTypes'>;
    const other = 'k57xyz' as Id<'subscriptionTypes'>;
    expect(
      matchesTrigger({ type: 'consent_updated' }, { type: 'consent_updated', typeIds: [] }),
    ).toBe(true);
    expect(
      matchesTrigger(
        { type: 'consent_updated', typeId },
        { type: 'consent_updated', typeIds: [other, typeId] },
      ),
    ).toBe(true);
    expect(
      matchesTrigger({ type: 'consent_updated', typeId }, { type: 'consent_updated', typeIds: [] }),
    ).toBe(false);
  });

  test('the route refuses an unknown token, a bad body, and the eleventh write of a minute', async () => {
    const { t, token } = await setup();
    const unknown = await post(t, 'nope', { unsubscribeAll: true });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ ok: false, code: 'invalid_token' });
    expect((await t.fetch('/consent/', { method: 'POST' })).status).toBe(404);
    const bad = await t.fetch(`/consent/${token}`, { method: 'POST', headers: IP, body: '[' });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 10; i++) {
      expect((await post(t, token, { types: {} })).status).toBe(200);
    }
    const eleventh = await post(t, token, { types: {} });
    expect(eleventh.status).toBe(429);
    expect(await eleventh.json()).toEqual({ ok: false, code: 'rate_limited' });
    expect((await t.fetch(`/consent/${token}`, { method: 'OPTIONS' })).status).toBe(204);
  });
});

describe('consent events elsewhere', () => {
  const std = (field: FormStandardField, label: string, required = false): FormFieldInput => ({
    target: { kind: 'standard', field },
    label,
    required,
  });

  test('a contact a public form creates gets the proof of the box ticked: the channel and the types the form names, with the address hashed', async () => {
    const { t, as, types } = await setup();
    const form = {
      name: 'Contact',
      fields: [std('firstName', 'Prénom', true), std('email', 'E-mail', true)],
      buttonText: 'Envoyer',
      afterSubmit: { kind: 'message' as const, message: 'Merci !' },
      consentText: 'J’accepte de recevoir la newsletter.',
      active: true,
    };
    // The box grants e-mail: a type of another channel cannot hang from it.
    const smsId = await as.mutation(api.features.subscriptions.mutations.createSubscriptionType, {
      name: 'Alertes',
      channel: 'sms',
      legalBasis: 'consent',
      active: true,
    });
    await expect(
      as.mutation(api.features.forms.mutations.createForm, {
        ...form,
        subscriptionTypeIds: [smsId],
      }),
    ).rejects.toMatchObject({ data: { code: 'form_subscription_type_invalid' } });
    const formId = await as.mutation(api.features.forms.mutations.createForm, {
      ...form,
      subscriptionTypeIds: [types.newsletter],
    });
    const def = (await (await t.fetch(`/forms/${formId}/def`, { method: 'GET' })).json()) as {
      ts: number;
      sig: string;
    };
    setSystemTime(new Date(NOW + 5_000));
    const response = await t.fetch(`/forms/${formId}/submit`, {
      method: 'POST',
      headers: IP,
      body: JSON.stringify({
        consent: true,
        renderedAt: def.ts,
        renderSig: def.sig,
        values: { prenom: 'Grace', 'e-mail': 'grace@example.com' },
      }),
    });
    expect(response.status).toBe(200);
    const grace = await t.run((ctx) =>
      ctx.db
        .query('leads')
        .withIndex('by_email', (q) => q.eq('email', 'grace@example.com'))
        .first(),
    );
    expect(grace?.subscriptions).toMatchObject([
      { typeId: types.newsletter, status: 'in', source: 'form' },
    ]);
    const events = await eventsOf(t, grace?._id as Id<'leads'>);
    expect(events.map((e) => [e.channel ?? e.typeId, e.from, e.to, e.source])).toEqual([
      ['email', 'out', 'in', 'form'],
      [types.newsletter, 'out', 'in', 'form'],
    ]);
    expect(new Set(events.map((e) => e.ipHash)).size).toBe(1);
    expect(events[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a merge keeps a withdrawal over the other record’s grant and the newer choice per type, and signs the changes as events', async () => {
    const { t, as, types, leadId } = await setup();
    const absorbedId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'L.',
      email: 'ada.l@example.com',
    });
    // The survivor withdrew e-mail; the absorbed record holds e-mail and SMS.
    await setConsentChannels(t, leadId, []);
    await setConsentChannels(t, absorbedId, ['email', 'sms']);
    const earlier = NOW - 1000;
    await t.run(async (ctx) => {
      await ctx.db.patch(leadId, {
        subscriptions: [
          { typeId: types.newsletter, status: 'out', source: 'preference_center', at: NOW },
          { typeId: types.product, status: 'out', source: 'preference_center', at: earlier },
        ],
      });
      await ctx.db.patch(absorbedId, {
        subscriptions: [
          { typeId: types.newsletter, status: 'in', source: 'preference_center', at: earlier },
          { typeId: types.product, status: 'in', source: 'preference_center', at: NOW },
          { typeId: types.invitations, status: 'out', source: 'preference_center', at: NOW },
        ],
      });
    });
    const before = (await eventsOf(t, leadId)).length;
    await as.mutation(api.features.duplicates.mutations.mergeLeads, {
      survivorId: leadId,
      absorbedId,
      fields: {},
    });
    const survivor = await t.run((ctx) => ctx.db.get(leadId));
    expect(survivor?.marketingConsent).toEqual(['sms']);
    expect(survivor?.consentSource).toBe('merge');
    expect(survivor?.subscriptions?.map((s) => `${s.typeId}:${s.status}`).sort()).toEqual(
      [`${types.newsletter}:out`, `${types.product}:in`, `${types.invitations}:out`].sort(),
    );
    const added = (await eventsOf(t, leadId)).slice(before);
    expect(added.map((e) => [e.channel ?? e.typeId, e.to, e.source])).toEqual([
      ['sms', 'in', 'merge'],
    ]);
  });

  test('the filter « est inscrit à » reads the active types; scoring rules and dynamic lists refuse it', async () => {
    const { t, as, types, leadId, token } = await setup();
    const bobId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Bob',
      lastName: 'Martin',
      email: 'bob@example.com',
    });
    const rule = (operator: 'contains' | 'isEmpty' | 'isNotEmpty', value?: string[]) => ({
      advancedFilter: {
        combinator: 'and' as const,
        groups: [
          {
            combinator: 'and' as const,
            rules: [
              {
                field: { kind: 'standard' as const, field: 'subscribedTo' as const },
                operator,
                value,
              },
            ],
          },
        ],
      },
    });
    const ids = async (filter: ReturnType<typeof rule>) => {
      const page = await as.query(api.features.leads.queries.matchingLeadsPage, {
        ...filter,
        cursor: null,
      });
      return page.leadIds;
    };
    await post(t, token, { types: { [types.newsletter]: true } });
    expect(await ids(rule('contains', [types.newsletter]))).toEqual([leadId]);
    expect(await ids(rule('contains', [types.product]))).toEqual([]);
    expect(await ids(rule('isEmpty'))).toEqual([bobId]);
    expect(await ids(rule('isNotEmpty'))).toEqual([leadId]);
    await as.mutation(api.features.subscriptions.mutations.updateSubscriptionType, {
      typeId: types.newsletter,
      active: false,
    });
    expect((await ids(rule('isEmpty'))).sort()).toEqual([leadId, bobId].sort());
    expect(await ids(rule('contains', [types.newsletter]))).toEqual([]);

    await expect(
      as.mutation(api.features.scoring.mutations.createScoringRule, {
        name: 'Abonnés',
        criteria: rule('isNotEmpty').advancedFilter,
        points: 10,
        active: true,
      }),
    ).rejects.toMatchObject({ data: { code: 'scoring_criteria_forbidden_field' } });
    await expect(
      as.mutation(api.features.leadLists.mutations.createLeadList, {
        name: 'Abonnés',
        kind: 'dynamic',
        criteria: rule('isNotEmpty').advancedFilter,
      }),
    ).rejects.toMatchObject({ data: { code: 'dynamic_list_criteria_list_rule' } });
  });

  test('the archive lists the events and the choices; the erasure takes them away', async () => {
    const { t, as, types, leadId, token } = await setup();
    await post(t, token, { types: { [types.newsletter]: true } });
    await post(t, token, { types: { [types.newsletter]: false } });
    const { archive } = await as.action(api.features.rgpd.actions.exportContactData, { leadId });
    // The channel joined, the newsletter chosen, the newsletter left.
    expect(archive.consentEvents).toHaveLength(3);
    expect(archive.contact.subscriptions).toMatchObject([
      { typeId: types.newsletter, status: 'out' },
    ]);
    await as.mutation(api.features.rgpd.mutations.eraseContact, { leadId, confirm: true });
    await runAll(t, NOW);
    expect(await t.run((ctx) => ctx.db.get(leadId))).toBeNull();
    expect(await eventsOf(t, leadId)).toEqual([]);
  });
});
