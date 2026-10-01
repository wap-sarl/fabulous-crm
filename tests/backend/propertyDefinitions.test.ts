import { beforeEach, describe, expect, jest, test } from 'bun:test';
import type { FunctionArgs } from 'convex/server';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.parse('2026-09-25T10:00:00Z');
// Inside the hour the seeded sessions last.
const LATER = NOW + 10 * 60 * 1000;
beforeEach(() => {
  pinClock(NOW);
});

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const editor = await seedEmployee(t, { email: 'editor@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  const as = asIdentity(t, admin.identity);
  const text = await as.mutation(api.features.properties.mutations.createDefinition, {
    entityType: 'lead',
    label: 'Spécialité',
    type: 'text',
    showInTable: false,
  });
  const select = await as.mutation(api.features.properties.mutations.createDefinition, {
    entityType: 'lead',
    label: 'Offre',
    type: 'select',
    options: [
      { value: 'basic', label: 'Basique' },
      { value: 'pro', label: 'Pro' },
    ],
    showInTable: true,
  });
  const number = await as.mutation(api.features.properties.mutations.createDefinition, {
    entityType: 'company',
    label: 'Sièges',
    type: 'number',
    validation: { min: 1, max: 500 },
    showInTable: false,
  });
  // The edits come later and from someone else, so the stamps tell them from the creation.
  jest.setSystemTime(new Date(LATER));
  return {
    t,
    admin,
    editor,
    as,
    asEditor: asIdentity(t, editor.identity),
    asMember: asIdentity(t, member.identity),
    text,
    select,
    number,
  };
}

type Update = Omit<
  FunctionArgs<typeof api.features.properties.mutations.updateDefinition>,
  'definitionId'
>;

const stored = (t: T, definitionId: Id<'propertyDefinitions'>) =>
  t.run((ctx) => ctx.db.get(definitionId));

const auditOf = (t: T, definitionId: Id<'propertyDefinitions'>) =>
  t.run(async (ctx) =>
    (
      await ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) =>
          q.eq('entityType', 'propertyDefinition').eq('entityId', definitionId),
        )
        .collect()
    ).map(({ action, userId, timestamp, metadata }) => ({ action, userId, timestamp, metadata })),
  );

describe('editing a property definition', () => {
  test('answers its id, writes the label, the column and the order, and audits what changed', async () => {
    const { t, asEditor, admin, editor, text } = await setup();

    expect(
      await asEditor.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        label: '  Discipline  ',
        showInTable: true,
        order: 5,
      }),
    ).toBe(text);

    expect(await stored(t, text)).toMatchObject({
      entityType: 'lead',
      type: 'text',
      label: 'Discipline',
      showInTable: true,
      order: 5,
      createdBy: admin.userId,
      updatedBy: editor.userId,
      updatedAt: LATER,
    });
    expect((await auditOf(t, text)).at(-1)).toEqual({
      action: 'update',
      userId: editor.userId,
      timestamp: LATER,
      metadata: {
        changes: {
          label: { old: 'Spécialité', new: 'Discipline' },
          showInTable: { old: false, new: true },
          order: { old: 1, new: 5 },
        },
      },
    });
  });

  test('an edit that changes nothing answers the id, stamps the row and audits nothing', async () => {
    const { t, asEditor, editor, text } = await setup();
    expect(
      await asEditor.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        label: 'Spécialité',
        showInTable: false,
      }),
    ).toBe(text);
    expect(await stored(t, text)).toMatchObject({
      label: 'Spécialité',
      updatedBy: editor.userId,
      updatedAt: LATER,
    });
    expect((await auditOf(t, text)).map((row) => row.action)).toEqual(['create']);
  });

  test('the options of a select are replaced, trimmed, the empty ones dropped', async () => {
    const { t, as, select } = await setup();
    expect(
      await as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: select,
        options: [
          { value: ' pro ', label: ' Pro ' },
          { value: '  ', label: 'Vide' },
          { value: 'gold', label: 'Or' },
        ],
      }),
    ).toBe(select);

    const options = [
      { value: 'pro', label: 'Pro' },
      { value: 'gold', label: 'Or' },
    ];
    expect((await stored(t, select))?.options).toEqual(options);
    expect((await auditOf(t, select)).at(-1)?.metadata).toEqual({
      changes: {
        options: {
          old: [
            { value: 'basic', label: 'Basique' },
            { value: 'pro', label: 'Pro' },
          ],
          new: options,
        },
      },
    });
  });

  test('a select refuses to lose its options or to hold a value twice', async () => {
    const { t, as, select } = await setup();
    const update = (args: Update) =>
      as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: select,
        ...args,
      });
    await expect(update({ options: [] })).rejects.toMatchObject({
      data: { code: 'options_required' },
    });
    await expect(update({ options: [{ value: ' ', label: 'Vide' }] })).rejects.toMatchObject({
      data: { code: 'options_required' },
    });
    await expect(
      update({
        options: [
          { value: 'pro', label: 'Pro' },
          { value: 'pro ', label: 'Professionnel' },
        ],
      }),
    ).rejects.toMatchObject({ data: { code: 'duplicate_option_values' } });
    expect((await stored(t, select))?.options).toHaveLength(2);
    expect((await stored(t, select))?.updatedAt).toBe(NOW);
  });

  test('options sent for a type that has none are ignored', async () => {
    const { t, as, text } = await setup();
    expect(
      await as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        options: [{ value: 'a', label: 'A' }],
      }),
    ).toBe(text);
    expect((await stored(t, text))?.options).toBeUndefined();
    expect((await auditOf(t, text)).map((row) => row.action)).toEqual(['create']);
  });

  test('the rules of a number are replaced, those of another type dropped', async () => {
    const { t, as, number } = await setup();
    expect(
      await as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: number,
        validation: { min: 10, max: 1000, minLength: 2, pattern: '^a' },
      }),
    ).toBe(number);
    expect((await stored(t, number))?.validation).toEqual({ min: 10, max: 1000 });
    expect((await auditOf(t, number)).at(-1)?.metadata).toEqual({
      changes: { validation: { old: { min: 1, max: 500 }, new: { min: 10, max: 1000 } } },
    });
  });

  test('a text takes its lengths and its pattern, an empty pattern counts for none', async () => {
    const { t, as, text } = await setup();
    const update = (validation: NonNullable<Update['validation']>) =>
      as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        validation,
      });
    expect(await update({ minLength: 2, maxLength: 40, pattern: '^[A-Z]' })).toBe(text);
    expect((await stored(t, text))?.validation).toEqual({
      minLength: 2,
      maxLength: 40,
      pattern: '^[A-Z]',
    });
    expect(await update({ maxLength: 40, pattern: '' })).toBe(text);
    expect((await stored(t, text))?.validation).toEqual({ maxLength: 40 });
  });

  test('an emptied rule set clears the stored rules', async () => {
    const { t, as, number, text } = await setup();
    expect(
      await as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: number,
        validation: {},
      }),
    ).toBe(number);
    const cleared = await stored(t, number);
    expect(cleared).not.toBeNull();
    expect(cleared?.validation).toBeUndefined();
    expect(cleared?.label).toBe('Sièges');

    // Rules of another type only: none remains.
    await as.mutation(api.features.properties.mutations.updateDefinition, {
      definitionId: text,
      validation: { minLength: 3 },
    });
    await as.mutation(api.features.properties.mutations.updateDefinition, {
      definitionId: text,
      validation: { min: 1, max: 2 },
    });
    expect((await stored(t, text))?.validation).toBeUndefined();
  });

  test('rules that contradict themselves are refused', async () => {
    const { t, as, number, text } = await setup();
    const update = (
      definitionId: Id<'propertyDefinitions'>,
      validation: NonNullable<Update['validation']>,
    ) =>
      as.mutation(api.features.properties.mutations.updateDefinition, { definitionId, validation });

    await expect(update(number, { min: 10, max: 1 })).rejects.toMatchObject({
      data: { code: 'invalid_range' },
    });
    await expect(update(text, { minLength: -1 })).rejects.toMatchObject({
      data: { code: 'invalid_length' },
    });
    await expect(update(text, { maxLength: -5 })).rejects.toMatchObject({
      data: { code: 'invalid_length' },
    });
    await expect(update(text, { minLength: 10, maxLength: 2 })).rejects.toMatchObject({
      data: { code: 'invalid_range' },
    });
    await expect(update(text, { pattern: '([a-z' })).rejects.toMatchObject({
      data: { code: 'invalid_pattern' },
    });
    expect((await stored(t, number))?.validation).toEqual({ min: 1, max: 500 });
    expect((await stored(t, text))?.validation).toBeUndefined();
  });

  test('a blank label is refused', async () => {
    const { t, as, text } = await setup();
    await expect(
      as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        label: '   ',
      }),
    ).rejects.toMatchObject({ data: { code: 'label_required' } });
    expect((await stored(t, text))?.label).toBe('Spécialité');
  });

  test('a deleted definition, or one that is gone, is refused', async () => {
    const { t, as, text, number } = await setup();
    await as.mutation(api.features.properties.mutations.deleteDefinition, { definitionId: text });
    await expect(
      as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        label: 'Discipline',
      }),
    ).rejects.toMatchObject({ data: { code: 'definition_not_found' } });
    expect((await stored(t, text))?.label).toBe('Spécialité');

    await t.run((ctx) => ctx.db.delete(number));
    await expect(
      as.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: number,
        label: 'Postes',
      }),
    ).rejects.toMatchObject({ data: { code: 'definition_not_found' } });
  });

  test('is refused without the settings access', async () => {
    const { t, asMember, text } = await setup();
    await expect(
      asMember.mutation(api.features.properties.mutations.updateDefinition, {
        definitionId: text,
        label: 'Discipline',
      }),
    ).rejects.toThrow('Unauthorized: settings access');
    expect((await stored(t, text))?.label).toBe('Spécialité');
  });
});

describe('deleting a property definition', () => {
  test('answers null, takes it off the lists, keeps the stored values and is audited', async () => {
    const { t, as, asEditor, admin, editor, text, select } = await setup();
    const leadId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Léa',
      lastName: 'Martin',
      email: 'lea@example.com',
      customProperties: { [text]: 'Cardiologie', [select]: 'pro' },
    });

    expect(
      await asEditor.mutation(api.features.properties.mutations.deleteDefinition, {
        definitionId: text,
      }),
    ).toBeNull();

    expect(await stored(t, text)).toMatchObject({
      label: 'Spécialité',
      deletedAt: LATER,
      createdBy: admin.userId,
      updatedBy: editor.userId,
      updatedAt: LATER,
    });
    expect(await auditOf(t, text)).toEqual([
      { action: 'create', userId: admin.userId, timestamp: NOW, metadata: undefined },
      { action: 'delete', userId: editor.userId, timestamp: LATER, metadata: undefined },
    ]);
    const listed = await as.query(api.features.properties.queries.listDefinitions, {
      entityType: 'lead',
    });
    expect(listed.map((def) => def._id)).toEqual([select]);
    const all = await as.query(api.features.properties.queries.listDefinitions, {});
    expect(all.map((def) => def._id)).not.toContain(text);
    // The value stays on the contact, to come back if the definition is restored.
    expect((await t.run((ctx) => ctx.db.get(leadId)))?.customProperties).toEqual({
      [text]: 'Cardiologie',
      [select]: 'pro',
    });
  });

  test('a definition already deleted, or one that is gone, is refused', async () => {
    const { t, as, text, number } = await setup();
    await as.mutation(api.features.properties.mutations.deleteDefinition, { definitionId: text });
    await expect(
      as.mutation(api.features.properties.mutations.deleteDefinition, { definitionId: text }),
    ).rejects.toMatchObject({ data: { code: 'definition_not_found' } });
    expect((await auditOf(t, text)).map((row) => row.action)).toEqual(['create', 'delete']);

    await t.run((ctx) => ctx.db.delete(number));
    await expect(
      as.mutation(api.features.properties.mutations.deleteDefinition, { definitionId: number }),
    ).rejects.toMatchObject({ data: { code: 'definition_not_found' } });
  });

  test('is refused without the settings access', async () => {
    const { t, asMember, text } = await setup();
    await expect(
      asMember.mutation(api.features.properties.mutations.deleteDefinition, {
        definitionId: text,
      }),
    ).rejects.toThrow('Unauthorized: settings access');
    expect((await stored(t, text))?.deletedAt).toBeUndefined();
  });
});
