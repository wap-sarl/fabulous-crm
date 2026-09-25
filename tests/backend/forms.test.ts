import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { FormField, FormStandardField } from '../../convex/_lib/validators/forms';
import { setExtensionsForTests } from '../../convex/extensions';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => {
  setExtensionsForTests(null);
  setSystemTime();
});
/** The clock moves forward: a render stamp is signed, so a submission's age can only come from time passing. */
const advance = (ms: number) => setSystemTime(new Date(Date.now() + ms));

const std = (field: FormStandardField, label: string, required = false): FormField => ({
  target: { kind: 'standard', field },
  label,
  required,
});

async function setup() {
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'WAP',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      updatedAt: Date.now(),
    }),
  );
  return { t, emp, as };
}

type As = ReturnType<typeof asIdentity>;

/** The acceptance form: prénom, e-mail, société (+ consent, built-in). */
function createAcceptanceForm(as: As, extra?: { active?: boolean; fields?: FormField[] }) {
  return as.mutation(api.features.forms.mutations.createForm, {
    name: 'Contact',
    fields: extra?.fields ?? [
      std('firstName', 'Prénom', true),
      std('email', 'E-mail', true),
      std('company', 'Société'),
      std('phone', 'Téléphone'),
    ],
    buttonText: 'Envoyer',
    afterSubmit: { kind: 'message', message: 'Merci !' },
    consentText: 'J’accepte de recevoir des communications.',
    active: extra?.active ?? true,
  });
}

/** The signed render stamp a real embed holds. */
async function stamp(t: T, formId: string) {
  const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
  return (await def.json()) as { ts: number; sig: string };
}

async function submit(
  t: T,
  formId: string,
  body: Record<string, unknown>,
  overrides?: Record<string, unknown>,
) {
  const { ts, sig } = await stamp(t, formId);
  advance(5_000);
  return t.fetch(`/forms/${formId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      renderedAt: ts,
      renderSig: sig,
      values: body,
      ...overrides,
    }),
  });
}

const liveLeads = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query('leads').collect()).filter((l) => l.deletedAt === undefined),
  );

describe('capture forms', () => {
  test('public routes serve the embed script and the definition; inactive forms 404', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    const js = await t.fetch(`/forms/${formId}/embed.js`, { method: 'GET' });
    expect(js.status).toBe(200);
    expect(await js.text()).toContain('document.currentScript');

    const page = await t.fetch(`/forms/${formId}`, { method: 'GET' });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`/forms/${formId}/embed.js`);

    const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
    expect(def.status).toBe(200);
    const body = (await def.json()) as { fields: { key: string }[]; ts: number };
    expect(body.fields.map((f) => f.key)).toEqual(['prenom', 'e-mail', 'societe', 'telephone']);

    await as.mutation(api.features.forms.mutations.updateForm, { formId, active: false });
    expect((await t.fetch(`/forms/${formId}/def`, { method: 'GET' })).status).toBe(404);
    expect((await t.fetch('/forms/nope/def', { method: 'GET' })).status).toBe(404);
  });

  test('acceptance: a submission creates the lead, its consent, company, signals, audit and timeline entry', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const acme = await as.mutation(api.features.companies.mutations.createCompany, {
      name: 'Acme Corp',
      country: 'FR',
      domain: 'acme-corp.fr',
    });

    // A workflow on any form submission must enroll the new lead.
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Wf formulaire',
      trigger: { type: 'form_submitted' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });

    const res = await submit(t, formId, {
      prenom: 'Nadia',
      'e-mail': 'nadia@acme-corp.fr',
      societe: 'Acme Corp',
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { ok: boolean; visitorToken?: string };
    expect(out.ok).toBe(true);
    expect(out.visitorToken).toBeDefined();

    const leads = await liveLeads(t);
    expect(leads).toHaveLength(1);
    const lead = leads[0];
    expect(lead.firstName).toBe('Nadia');
    expect(lead.email).toBe('nadia@acme-corp.fr');
    expect(lead.marketingConsent).toEqual(['email']);
    expect(lead.consentSource).toBe('form');
    expect(lead.lifecycleStage).toBe('lead');
    expect(lead.formSubmissionCount).toBe(1);
    expect(lead.lastFormSubmissionAt).toBeDefined();
    expect(lead.ownerIds).toEqual([]);

    // The e-mail's domain attaches the contact to the existing company; the typed name creates nothing.
    expect(lead.companyId).toBe(acme);
    expect(await t.run((ctx) => ctx.db.query('companies').collect())).toHaveLength(1);
    const audits = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter(
        (a) =>
          a.entityType === 'lead' &&
          (a.metadata as { source?: string } | undefined)?.source === 'form',
      ),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'create',
      entityId: lead._id,
      metadata: { source: 'form', formId },
    });
    expect(audits[0].userId).toBeUndefined();

    const submissions = await t.run((ctx) => ctx.db.query('formSubmissions').collect());
    expect(submissions).toHaveLength(1);
    expect(submissions[0].values.prenom).toBe('Nadia');
    expect(submissions[0].ipHash).toMatch(/^[0-9a-f]{64}$/);

    const runs = await t.run((ctx) => ctx.db.query('workflowRuns').collect());
    expect(runs).toHaveLength(1);
    expect(runs[0].triggerType).toBe('form_submitted');

    const timeline = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId: lead._id,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const entry = timeline.page.find((e) => e.kind === 'form_submission');
    expect(entry).toMatchObject({
      formName: 'Contact',
      fieldLabels: ['Prénom', 'E-mail', 'Société'],
    });
  });

  test('a known e-mail completes the contact and never overwrites it; consent and triggers stay untouched', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as, {
      fields: [
        std('firstName', 'Prénom'),
        std('email', 'E-mail', true),
        std('company', 'Société'),
        std('phone', 'Téléphone'),
        std('comment', 'Commentaire'),
      ],
    });
    // An existing contact with a name and a phone, no consent, watched by a workflow on property changes.
    const leadId = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Léa',
      lastName: 'Martin',
      email: 'lea@example.com',
      phone: '+33600000000',
    });
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Sur changement',
      trigger: { type: 'lead_property_changed' },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });

    const res = await submit(t, formId, {
      prenom: 'Quelqu’un',
      'e-mail': 'LEA@example.com',
      telephone: '+33699999999',
      societe: 'Acme',
      commentaire: 'Rappelez-moi',
    });
    expect(res.status).toBe(200);
    const leads = await liveLeads(t);
    expect(leads).toHaveLength(1);
    const lead = leads[0];
    expect(lead._id).toBe(leadId);
    // Nothing overwritten, the empty comment filled, nothing consented, no company from a typed name.
    expect(lead).toMatchObject({
      firstName: 'Léa',
      phone: '+33600000000',
      comment: 'Rappelez-moi',
      marketingConsent: [],
    });
    expect(lead.consentSource).toBeUndefined();
    expect(lead.companyId).toBeUndefined();
    // Nothing typed on a fresh browser counts as their behaviour, and no property trigger fires.
    expect(lead.formSubmissionCount).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query('workflowRuns').collect())).toEqual([]);
    expect(
      await t.run(async (ctx) => (await ctx.db.query('formSubmissions').collect()).length),
    ).toBe(1);
    // The one write is audited as the form's.
    const updates = await t.run(async (ctx) =>
      (await ctx.db.query('auditLogs').collect()).filter(
        (a) =>
          a.entityId === leadId &&
          a.action === 'update' &&
          (a.metadata as { source?: string })?.source === 'form',
      ),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].metadata).toMatchObject({ changes: { comment: { new: 'Rappelez-moi' } } });
  });

  test('a deleted contact is a stranger, and a token with another address names nobody', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const ghost = await as.mutation(api.features.crm.mutations.createLead, {
      firstName: 'Ghost',
      lastName: 'Lead',
      email: 'ghost@example.com',
    });
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId: ghost });
    await submit(t, formId, { prenom: 'Revenant', 'e-mail': 'ghost@example.com' });
    const live = await liveLeads(t);
    expect(live).toHaveLength(1);
    expect(live[0]._id).not.toBe(ghost);
    expect((await t.run((ctx) => ctx.db.get(ghost)))?.deletedAt).toBeDefined();

    // The browser that created Marc now types someone else's address: a new contact, Marc untouched.
    const first = await submit(t, formId, { prenom: 'Marc', 'e-mail': 'marc@example.com' });
    const { visitorToken } = (await first.json()) as { visitorToken: string };
    await submit(
      t,
      formId,
      { prenom: 'Julie', 'e-mail': 'julie@example.com', telephone: '+33611111111' },
      { visitorToken },
    );
    const marc = (await liveLeads(t)).find((l) => l.email === 'marc@example.com');
    expect(marc?.phone).toBeUndefined();
    expect((await liveLeads(t)).map((l) => l.email).sort()).toEqual([
      'ghost@example.com',
      'julie@example.com',
      'marc@example.com',
    ]);
    // The same browser, the same address: the phone is filled and the counter moves.
    await submit(
      t,
      formId,
      { 'e-mail': 'marc@example.com', telephone: '+33622222222' },
      { visitorToken },
    );
    const marcAgain = (await liveLeads(t)).find((l) => l.email === 'marc@example.com');
    expect(marcAgain).toMatchObject({ phone: '+33622222222', formSubmissionCount: 2 });
  });

  test('a form without an e-mail field never uses the visitor token: a shared browser makes new contacts', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as, {
      fields: [std('firstName', 'Prénom', true), std('phone', 'Téléphone')],
    });
    const first = await submit(t, formId, { prenom: 'Borne', telephone: '+33611111111' });
    const { visitorToken } = (await first.json()) as { visitorToken: string };
    const def = await t.fetch(`/forms/${formId}/def?visitor=${visitorToken}`, { method: 'GET' });
    expect(((await def.json()) as { knownFields: string[] }).knownFields).toEqual([]);
    await submit(t, formId, { prenom: 'Suivant' }, { visitorToken });
    expect((await liveLeads(t)).map((l) => l.firstName).sort()).toEqual(['Borne', 'Suivant']);
  });

  test('the form filter of a form_submitted trigger keeps other forms out', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const other = await createAcceptanceForm(as);
    const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
      name: 'Autre formulaire',
      trigger: { type: 'form_submitted', formId: other },
      allowReEnrollment: true,
      nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
      startNodeId: 'n1',
    });
    await as.mutation(api.features.workflows.mutations.setWorkflowStatus, {
      workflowId,
      status: 'active',
    });
    await submit(t, formId, { prenom: 'Nina', 'e-mail': 'nina@example.com' });
    expect(await t.run((ctx) => ctx.db.query('workflowRuns').collect())).toEqual([]);
    await submit(t, other, { prenom: 'Nina', 'e-mail': 'nina@example.com' });
    expect(await t.run((ctx) => ctx.db.query('workflowRuns').collect())).toHaveLength(1);
  });

  test('a typed company name creates nothing: it lands in the new contact’s comment, the domain alone attaches', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    await submit(t, formId, { prenom: 'Paul', 'e-mail': 'paul@gmail.com', societe: 'Acme' });
    const paul = (await liveLeads(t))[0];
    expect(paul.companyId).toBeUndefined();
    expect(paul.comment).toBe('Entreprise indiquée : Acme');
    expect(await t.run((ctx) => ctx.db.query('companies').collect())).toEqual([]);
  });

  test('progressive profiling: a known visitor is only asked the missing fields', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    const first = await submit(t, formId, {
      prenom: 'Marc',
      'e-mail': 'marc@example.com',
    });
    const { visitorToken } = (await first.json()) as { visitorToken: string };

    // The definition now flags the filled fields so the embed skips them.
    const def = await t.fetch(`/forms/${formId}/def?visitor=${visitorToken}`, { method: 'GET' });
    const body = (await def.json()) as { knownFields: string[] };
    expect(body.knownFields.sort()).toEqual(['e-mail', 'prenom']);

    // Second visit: only the phone is submitted; the required email is known.
    const second = await submit(t, formId, { telephone: '+33698765432' }, { visitorToken });
    expect(second.status).toBe(200);
    const leads = await liveLeads(t);
    expect(leads).toHaveLength(1);
    expect(leads[0].phone).toBe('+33698765432');
    expect(leads[0].email).toBe('marc@example.com');
  });

  test('honeypot and minimum fill time keep bots out; consent stays mandatory', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const values = { prenom: 'Bot', 'e-mail': 'bot@example.com' };

    // Honeypot filled: pretend success, write nothing.
    const honeypot = await submit(t, formId, values, { honeypot: 'https://spam.example' });
    expect(honeypot.status).toBe(200);
    const decoy = (await honeypot.json()) as { ok: boolean; visitorToken?: string };
    expect(decoy.ok).toBe(true);
    expect(decoy.visitorToken).toMatch(/^[0-9a-f]{48}$/);
    expect(await t.run((ctx) => ctx.db.query('formVisitorTokens').collect())).toEqual([]);
    expect(await liveLeads(t)).toHaveLength(0);

    const post = (body: Record<string, unknown>) =>
      t.fetch(`/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, values, ...body }),
      });
    // Submitted faster than a human could fill the form.
    const fresh = await stamp(t, formId);
    const tooFast = await post({ renderedAt: fresh.ts, renderSig: fresh.sig });
    expect(tooFast.status).toBe(400);
    expect(((await tooFast.json()) as { code: string }).code).toBe('too_fast');
    // A stamp the bot made up, or none: the time is not ours to trust without our signature.
    advance(10_000);
    const forged = await post({ renderedAt: fresh.ts - 60_000, renderSig: fresh.sig });
    expect(((await forged.json()) as { code: string }).code).toBe('too_fast');
    expect((await post({ renderedAt: fresh.ts })).status).toBe(400);
    // A page left open for a day: stale, so the embed fetches a new stamp and tries again.
    advance(25 * 60 * 60 * 1000);
    const stale = await post({ renderedAt: fresh.ts, renderSig: fresh.sig });
    expect(((await stale.json()) as { code: string }).code).toBe('stale');

    const noConsent = await submit(t, formId, values, { consent: false });
    expect(noConsent.status).toBe(400);
    expect(((await noConsent.json()) as { code: string }).code).toBe('consent_required');
    expect(await liveLeads(t)).toHaveLength(0);
  });

  test('required fields and formats are validated server-side', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    const missing = await submit(t, formId, { prenom: 'Sam' });
    expect(missing.status).toBe(400);
    const body = (await missing.json()) as { code: string; errors: Record<string, string> };
    expect(body.code).toBe('invalid_fields');
    expect(body.errors['e-mail']).toBeDefined();

    const badEmail = await submit(t, formId, {
      prenom: 'Sam',
      'e-mail': 'pas-un-email',
    });
    expect(badEmail.status).toBe(400);
    expect(
      ((await badEmail.json()) as { errors: Record<string, string> }).errors['e-mail'],
    ).toContain('invalide');
    expect(await liveLeads(t)).toHaveLength(0);
  });

  test('custom lead properties render with their type and store on the lead', async () => {
    const { t, as } = await setup();
    const defId = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Spécialité',
      type: 'select',
      options: [
        { value: 'cardio', label: 'Cardiologie' },
        { value: 'derma', label: 'Dermatologie' },
      ],
      showInTable: false,
    });
    const formId = await createAcceptanceForm(as, {
      fields: [
        std('email', 'E-mail', true),
        { target: { kind: 'custom', propertyDefId: defId }, label: 'Spécialité', required: true },
      ],
    });

    const def = await t.fetch(`/forms/${formId}/def`, { method: 'GET' });
    const body = (await def.json()) as {
      fields: { key: string; input: string; options?: unknown[] }[];
    };
    expect(body.fields[1]).toMatchObject({ input: 'select', key: 'specialite' });
    expect(body.fields[1].options).toHaveLength(2);

    // An option outside the list is refused; a valid one lands on the lead.
    const bad = await submit(t, formId, {
      'e-mail': 'doc@example.com',
      specialite: 'autre',
    });
    expect(bad.status).toBe(400);

    const good = await submit(t, formId, {
      'e-mail': 'doc@example.com',
      specialite: 'cardio',
    });
    expect(good.status).toBe(200);
    const leads = await liveLeads(t);
    expect(leads[0].customProperties?.[defId]).toBe('cardio');
  });

  test('submissions are rate-limited per IP', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const fresh = await stamp(t, formId);
    advance(5_000);
    const post = (body: Record<string, unknown>) =>
      t.fetch(`/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consent: true,
          renderedAt: fresh.ts,
          renderSig: fresh.sig,
          ...body,
        }),
      });
    // Burn the 10/min budget with honeypot no-ops, then a real attempt, the clock still.
    for (let i = 0; i < 10; i++) {
      expect((await post({ values: {}, honeypot: 'x' })).status).toBe(200);
    }
    const limited = await post({ values: { prenom: 'Trop', 'e-mail': 'trop@example.com' } });
    expect(limited.status).toBe(429);
    expect(await liveLeads(t)).toHaveLength(0);
  });

  test('a new contact goes through the lead gate as `form`; a refusal answers `unavailable` and creates nothing', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const calls: { count: number; source: string }[] = [];
    let refuse = true;
    setExtensionsForTests({
      beforeLeadCreate: async (_ctx, info) => {
        calls.push(info);
        if (refuse) throw new Error('contact_limit_reached');
      },
    });
    const refused = await submit(t, formId, {
      prenom: 'Ada',
      'e-mail': 'ada@example.com',
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ ok: false, code: 'unavailable' });
    expect(await liveLeads(t)).toHaveLength(0);
    expect(calls).toEqual([{ count: 1, source: 'form' }]);

    refuse = false;
    const accepted = await submit(t, formId, {
      prenom: 'Ada',
      'e-mail': 'ada@example.com',
    });
    expect(accepted.status).toBe(200);
    expect(await liveLeads(t)).toHaveLength(1);
    // A known e-mail updates the contact: nothing becomes live, the gate is not asked.
    await submit(t, formId, { prenom: 'Ada L.', 'e-mail': 'ada@example.com' });
    expect(calls).toHaveLength(2);
  });
});
