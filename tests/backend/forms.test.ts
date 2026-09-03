import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { FormField, FormStandardField } from '../../convex/_lib/validators/forms';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

const std = (field: FormStandardField, label: string, required = false): FormField => ({
  target: { kind: 'standard', field },
  label,
  required,
});

async function setup() {
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

function submit(
  t: T,
  formId: string,
  body: Record<string, unknown>,
  overrides?: Record<string, unknown>,
) {
  return t.fetch(`/forms/${formId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      consent: true,
      renderedAt: Date.now() - 5_000,
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
    expect(body.fields.map((f) => f.key)).toEqual([
      'std:firstName',
      'std:email',
      'std:company',
      'std:phone',
    ]);

    await as.mutation(api.features.forms.mutations.updateForm, { formId, active: false });
    expect((await t.fetch(`/forms/${formId}/def`, { method: 'GET' })).status).toBe(404);
    expect((await t.fetch('/forms/nope/def', { method: 'GET' })).status).toBe(404);
  });

  test('acceptance: a submission creates the lead, its consent, company, signals and timeline entry', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

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
      'std:firstName': 'Nadia',
      'std:email': 'nadia@acme-corp.fr',
      'std:company': 'Acme Corp',
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

    const company = lead.companyId ? await t.run((ctx) => ctx.db.get(lead.companyId!)) : null;
    expect(company?.name).toBe('Acme Corp');
    expect(company?.domain).toBe('acme-corp.fr');

    const submissions = await t.run((ctx) => ctx.db.query('formSubmissions').collect());
    expect(submissions).toHaveLength(1);
    expect(submissions[0].values['std:firstName']).toBe('Nadia');
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

  test('a second submission with the same email updates the lead instead of duplicating it', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    await submit(t, formId, { 'std:firstName': 'Léa', 'std:email': 'lea@example.com' });
    await submit(t, formId, {
      'std:firstName': 'Léa',
      'std:email': 'lea@example.com',
      'std:phone': '+33612345678',
    });

    const leads = await liveLeads(t);
    expect(leads).toHaveLength(1);
    expect(leads[0].phone).toBe('+33612345678');
    expect(leads[0].formSubmissionCount).toBe(2);
    expect(
      await t.run(async (ctx) => (await ctx.db.query('formSubmissions').collect()).length),
    ).toBe(2);
  });

  test('progressive profiling: a known visitor is only asked the missing fields', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    const first = await submit(t, formId, {
      'std:firstName': 'Marc',
      'std:email': 'marc@example.com',
    });
    const { visitorToken } = (await first.json()) as { visitorToken: string };

    // The definition now flags the filled fields so the embed skips them.
    const def = await t.fetch(`/forms/${formId}/def?visitor=${visitorToken}`, { method: 'GET' });
    const body = (await def.json()) as { knownFields: string[] };
    expect(body.knownFields.sort()).toEqual(['std:email', 'std:firstName']);

    // Second visit: only the phone is submitted; the required email is known.
    const second = await submit(t, formId, { 'std:phone': '+33698765432' }, { visitorToken });
    expect(second.status).toBe(200);
    const leads = await liveLeads(t);
    expect(leads).toHaveLength(1);
    expect(leads[0].phone).toBe('+33698765432');
    expect(leads[0].email).toBe('marc@example.com');
  });

  test('honeypot and minimum fill time keep bots out; consent stays mandatory', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);
    const values = { 'std:firstName': 'Bot', 'std:email': 'bot@example.com' };

    // Honeypot filled: pretend success, write nothing.
    const honeypot = await submit(t, formId, values, { honeypot: 'https://spam.example' });
    expect(honeypot.status).toBe(200);
    expect(((await honeypot.json()) as { ok: boolean }).ok).toBe(true);
    expect(await liveLeads(t)).toHaveLength(0);

    // Submitted faster than a human could fill the form.
    const tooFast = await submit(t, formId, values, { renderedAt: Date.now() });
    expect(tooFast.status).toBe(400);
    expect(((await tooFast.json()) as { code: string }).code).toBe('too_fast');

    // No renderedAt at all (bot POSTing without fetching the definition).
    const noTs = await submit(t, formId, values, { renderedAt: undefined });
    expect(noTs.status).toBe(400);

    const noConsent = await submit(t, formId, values, { consent: false });
    expect(noConsent.status).toBe(400);
    expect(((await noConsent.json()) as { code: string }).code).toBe('consent_required');
    expect(await liveLeads(t)).toHaveLength(0);
  });

  test('required fields and formats are validated server-side', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    const missing = await submit(t, formId, { 'std:firstName': 'Sam' });
    expect(missing.status).toBe(400);
    const body = (await missing.json()) as { code: string; errors: Record<string, string> };
    expect(body.code).toBe('invalid_fields');
    expect(body.errors['std:email']).toBeDefined();

    const badEmail = await submit(t, formId, {
      'std:firstName': 'Sam',
      'std:email': 'pas-un-email',
    });
    expect(badEmail.status).toBe(400);
    expect(
      ((await badEmail.json()) as { errors: Record<string, string> }).errors['std:email'],
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
    expect(body.fields[1]).toMatchObject({ input: 'select', key: `cp:${defId}` });
    expect(body.fields[1].options).toHaveLength(2);

    // An option outside the list is refused; a valid one lands on the lead.
    const bad = await submit(t, formId, {
      'std:email': 'doc@example.com',
      [`cp:${defId}`]: 'autre',
    });
    expect(bad.status).toBe(400);

    const good = await submit(t, formId, {
      'std:email': 'doc@example.com',
      [`cp:${defId}`]: 'cardio',
    });
    expect(good.status).toBe(200);
    const leads = await liveLeads(t);
    expect(leads[0].customProperties?.[defId]).toBe('cardio');
  });

  test('submissions are rate-limited per IP', async () => {
    const { t, as } = await setup();
    const formId = await createAcceptanceForm(as);

    // Burn the 10/min budget with honeypot no-ops, then a real attempt.
    for (let i = 0; i < 10; i++) {
      const res = await submit(t, formId, {}, { honeypot: 'x' });
      expect(res.status).toBe(200);
    }
    const limited = await submit(t, formId, {
      'std:firstName': 'Trop',
      'std:email': 'trop@example.com',
    });
    expect(limited.status).toBe(429);
    expect(await liveLeads(t)).toHaveLength(0);
  });
});
