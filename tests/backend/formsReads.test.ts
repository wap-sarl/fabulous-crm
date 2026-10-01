import { beforeEach, describe, expect, jest, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { FormFieldInput, FormStandardField } from '../../convex/_lib/validators/forms';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
beforeEach(() => {
  pinClock(NOW);
});
const at = (ms: number) => jest.setSystemTime(new Date(NOW + ms));

const std = (field: FormStandardField, label: string, required = false): FormFieldInput => ({
  target: { kind: 'standard', field },
  label,
  required,
});

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t);
  return {
    t,
    admin,
    as: asIdentity(t, admin.identity),
    asMember: asIdentity(t, member.identity),
  };
}

type As = ReturnType<typeof asIdentity>;

function createForm(
  as: As,
  name: string,
  extra: {
    fields?: FormFieldInput[];
    active?: boolean;
    afterSubmit?: { kind: 'message'; message: string } | { kind: 'redirect'; url: string };
  } = {},
) {
  return as.mutation(api.features.forms.mutations.createForm, {
    name,
    fields: extra.fields ?? [std('firstName', 'Prénom', true), std('email', 'E-mail', true)],
    buttonText: 'Envoyer',
    afterSubmit: extra.afterSubmit ?? { kind: 'message', message: 'Merci !' },
    consentText: 'J’accepte de recevoir des communications.',
    active: extra.active ?? true,
  });
}

/** A row is stamped just past the clock, so that two rows of the same instant keep their order. */
const createdAt = async (t: T, formId: Id<'forms'>) =>
  (await t.run((ctx) => ctx.db.get(formId)))?._creationTime ?? 0;

const auditOf = (t: T, formId: Id<'forms'>) =>
  t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .withIndex('by_entity', (q) => q.eq('entityType', 'form').eq('entityId', formId))
      .collect(),
  );

describe('the settings list of forms', () => {
  test('is empty before the first form', async () => {
    const { as } = await setup();
    expect(await as.query(api.features.forms.queries.listForms, {})).toEqual([]);
  });

  test('gives each live form with its field count, the newest first', async () => {
    const { t, as } = await setup();
    const contact = await createForm(as, 'Contact');
    at(1_000);
    const newsletter = await createForm(as, 'Newsletter', {
      fields: [std('email', 'E-mail', true)],
      active: false,
    });
    at(2_000);
    const removed = await createForm(as, 'Ancien');
    await as.mutation(api.features.forms.mutations.deleteForm, { formId: removed });

    const list = await as.query(api.features.forms.queries.listForms, {});
    expect(list).toEqual([
      {
        _id: newsletter,
        name: 'Newsletter',
        active: false,
        fieldCount: 1,
        createdAt: await createdAt(t, newsletter),
      },
      {
        _id: contact,
        name: 'Contact',
        active: true,
        fieldCount: 2,
        createdAt: await createdAt(t, contact),
      },
    ]);
    expect(list.map((form) => Math.floor(form.createdAt))).toEqual([NOW + 1_000, NOW]);
  });

  test('is refused without the settings access', async () => {
    const { asMember } = await setup();
    await expect(asMember.query(api.features.forms.queries.listForms, {})).rejects.toThrow(
      'Unauthorized: settings access',
    );
  });
});

describe('one form for the builder', () => {
  test('comes whole, with a standard and a custom field and a message after the submission', async () => {
    const { t, as, admin } = await setup();
    const specialty = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Spécialité',
      type: 'text',
      showInTable: false,
    });
    const formId = await createForm(as, '  Contact  ', {
      fields: [
        std('email', 'E-mail', true),
        {
          target: { kind: 'custom', propertyDefId: specialty },
          label: 'Spécialité',
          required: false,
        },
      ],
    });

    const form = await as.query(api.features.forms.queries.getForm, { formId });
    expect(form).toEqual({
      _id: formId,
      _creationTime: await createdAt(t, formId),
      name: 'Contact',
      fields: [
        {
          target: { kind: 'standard', field: 'email' },
          label: 'E-mail',
          required: true,
          key: 'e-mail',
        },
        {
          target: { kind: 'custom', propertyDefId: specialty },
          label: 'Spécialité',
          required: false,
          key: 'specialite',
        },
      ],
      buttonText: 'Envoyer',
      afterSubmit: { kind: 'message', message: 'Merci !' },
      consentText: 'J’accepte de recevoir des communications.',
      active: true,
      updatedAt: NOW,
      createdBy: admin.userId,
      updatedBy: admin.userId,
    });
  });

  test('carries a redirection after the submission, and its last edit', async () => {
    const { as, admin } = await setup();
    const formId = await createForm(as, 'Livre blanc', {
      afterSubmit: { kind: 'redirect', url: 'https://www.example.com/merci' },
      active: false,
    });
    at(60_000);
    await as.mutation(api.features.forms.mutations.updateForm, { formId, buttonText: 'Recevoir' });

    expect(await as.query(api.features.forms.queries.getForm, { formId })).toMatchObject({
      _id: formId,
      name: 'Livre blanc',
      afterSubmit: { kind: 'redirect', url: 'https://www.example.com/merci' },
      buttonText: 'Recevoir',
      active: false,
      updatedAt: NOW + 60_000,
      updatedBy: admin.userId,
    });
  });

  test('is null once the form is deleted', async () => {
    const { as } = await setup();
    const formId = await createForm(as, 'Contact');
    await as.mutation(api.features.forms.mutations.deleteForm, { formId });
    expect(await as.query(api.features.forms.queries.getForm, { formId })).toBeNull();
  });

  test('is null for a form that is gone from the table', async () => {
    const { t, as } = await setup();
    const formId = await createForm(as, 'Contact');
    await t.run((ctx) => ctx.db.delete(formId));
    expect(await as.query(api.features.forms.queries.getForm, { formId })).toBeNull();
  });

  test('is refused without the settings access', async () => {
    const { as, asMember } = await setup();
    const formId = await createForm(as, 'Contact');
    await expect(asMember.query(api.features.forms.queries.getForm, { formId })).rejects.toThrow(
      'Unauthorized: settings access',
    );
  });
});

describe('the form picker', () => {
  test('is empty before the first form', async () => {
    const { asMember } = await setup();
    expect(await asMember.query(api.features.forms.queries.listFormOptions, {})).toEqual([]);
  });

  test('names the live forms in French alphabetical order, for every employee', async () => {
    const { as, asMember } = await setup();
    const newsletter = await createForm(as, 'Newsletter');
    const evenement = await createForm(as, 'Événement', { active: false });
    const contact = await createForm(as, 'Contact');
    const removed = await createForm(as, 'Démo');
    await as.mutation(api.features.forms.mutations.deleteForm, { formId: removed });

    const expected = [
      { _id: contact, name: 'Contact' },
      { _id: evenement, name: 'Événement' },
      { _id: newsletter, name: 'Newsletter' },
    ];
    expect(await asMember.query(api.features.forms.queries.listFormOptions, {})).toEqual(expected);
    expect(await as.query(api.features.forms.queries.listFormOptions, {})).toEqual(expected);
  });
});

describe('deleting a form', () => {
  test('answers null, closes the form and keeps its submissions', async () => {
    const { t, as, admin } = await setup();
    const formId = await createForm(as, 'Contact');
    const leadId = await seedLead(t, { email: 'ada@example.com' });
    const submissionId = await t.run((ctx) =>
      ctx.db.insert('formSubmissions', {
        formId,
        leadId,
        values: { prenom: 'Ada', 'e-mail': 'ada@example.com' },
        ipHash: 'hash',
      }),
    );
    at(5_000);

    expect(await as.mutation(api.features.forms.mutations.deleteForm, { formId })).toBeNull();

    expect(await t.run((ctx) => ctx.db.get(formId))).toMatchObject({
      name: 'Contact',
      active: false,
      deletedAt: NOW + 5_000,
      updatedAt: NOW + 5_000,
      updatedBy: admin.userId,
    });
    expect(await t.run((ctx) => ctx.db.get(submissionId))).toMatchObject({ formId, leadId });
    expect((await auditOf(t, formId)).map((row) => [row.action, row.userId])).toEqual([
      ['create', admin.userId],
      ['delete', admin.userId],
    ]);
    // The public definition is gone with the form.
    expect((await t.fetch(`/forms/${formId}/def`, { method: 'GET' })).status).toBe(404);
  });

  test('is refused for a form already deleted, or gone from the table', async () => {
    const { t, as } = await setup();
    const deleted = await createForm(as, 'Contact');
    await as.mutation(api.features.forms.mutations.deleteForm, { formId: deleted });
    await expect(
      as.mutation(api.features.forms.mutations.deleteForm, { formId: deleted }),
    ).rejects.toMatchObject({ data: { code: 'form_not_found' } });
    // The refusal wrote nothing more.
    expect((await auditOf(t, deleted)).map((row) => row.action)).toEqual(['create', 'delete']);

    const gone = await createForm(as, 'Newsletter');
    await t.run((ctx) => ctx.db.delete(gone));
    await expect(
      as.mutation(api.features.forms.mutations.deleteForm, { formId: gone }),
    ).rejects.toMatchObject({ data: { code: 'form_not_found' } });
  });

  test('is refused without the settings access', async () => {
    const { t, as, asMember } = await setup();
    const formId = await createForm(as, 'Contact');
    await expect(
      asMember.mutation(api.features.forms.mutations.deleteForm, { formId }),
    ).rejects.toThrow('Unauthorized: settings access');
    expect((await t.run((ctx) => ctx.db.get(formId)))?.deletedAt).toBeUndefined();
  });
});
