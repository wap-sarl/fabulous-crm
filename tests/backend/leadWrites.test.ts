import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { asIdentity, createTestConvex, pinClock, seedEmployee, type T } from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const leads = api.features.leads.mutations;

async function setup() {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const leadId = await as.mutation(leads.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean@example.com',
  });
  return { t, as, emp, leadId };
}

const row = <Table extends 'leads' | 'leadNotes' | 'companies'>(t: T, id: Id<Table>) =>
  t.run((ctx) => ctx.db.get(id));
const auditsOf = (t: T, entityId: string) =>
  t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect())
      .filter((a) => a.entityId === entityId)
      .map((a) => ({
        action: a.action,
        entityType: a.entityType,
        userId: a.userId,
        metadata: a.metadata,
      })),
  );

describe('lead writes', () => {
  test('a company named at creation is found or created, and the contact attached to it', async () => {
    const { t, as } = await setup();
    const hinted = await as.mutation(leads.createLead, {
      firstName: 'Ada',
      lastName: 'L',
      email: 'ada@gmail.com',
      company: { name: 'Nouvelle SAS', domain: 'nouvelle.example' },
    });
    const companyId = (await row(t, hinted))?.companyId;
    expect(companyId).toBeDefined();
    expect((await row(t, companyId as Id<'companies'>))?.name).toBe('Nouvelle SAS');

    // The same domain again attaches to the same company; an explicit company wins over a hint.
    const again = await as.mutation(leads.createLead, {
      firstName: 'Bob',
      lastName: 'M',
      email: 'bob@gmail.com',
      company: { name: 'Autre nom', domain: 'nouvelle.example' },
    });
    expect((await row(t, again))?.companyId).toBe(companyId);
    const explicit = await as.mutation(leads.createLead, {
      firstName: 'Cy',
      lastName: 'N',
      email: 'cy@gmail.com',
      companyId,
      company: { name: 'Autre SARL' },
    });
    expect((await row(t, explicit))?.companyId).toBe(companyId);
    await t.run((ctx) => ctx.db.patch(companyId as Id<'companies'>, { deletedAt: NOW }));
    await expect(
      as.mutation(leads.createLead, { firstName: 'D', lastName: 'O', companyId }),
    ).rejects.toThrow('company_not_found');
  });

  test('an update replaces the custom properties it gives, attaches and detaches the company, and is audited once', async () => {
    const { t, as, emp, leadId } = await setup();
    const definitionId = await as.mutation(api.features.properties.mutations.createDefinition, {
      entityType: 'lead',
      label: 'Source',
      type: 'text',
      showInTable: false,
    });
    const companyId = await t.run((ctx) =>
      ctx.db.insert('companies', { name: 'Acme', country: 'FR', ownerIds: [], updatedAt: NOW }),
    );
    await as.mutation(leads.updateLead, {
      leadId,
      customProperties: { [definitionId]: 'salon', unknown: 'x' },
      companyId,
      phone: '+33612345678',
    });
    // A key that is no property of a contact is dropped.
    expect((await row(t, leadId))?.customProperties).toEqual({ [definitionId]: 'salon' });
    expect(await row(t, leadId)).toMatchObject({
      companyId,
      phone: '+33612345678',
      updatedBy: emp.userId,
    });
    await as.mutation(leads.updateLead, { leadId, companyId: null });
    expect((await row(t, leadId))?.companyId).toBeUndefined();
    // The same values again change nothing and leave no trace.
    await as.mutation(leads.updateLead, { leadId, phone: '+33612345678' });
    const updates = (await auditsOf(t, leadId)).filter((a) => a.action === 'update');
    expect(updates).toHaveLength(2);
    expect(Object.keys((updates[0].metadata as { changes: object }).changes).sort()).toEqual([
      'companyId',
      'customProperties',
      'phone',
    ]);

    await t.run((ctx) => ctx.db.patch(companyId, { deletedAt: NOW }));
    await expect(as.mutation(leads.updateLead, { leadId, companyId })).rejects.toThrow(
      'company_not_found',
    );
    await expect(
      as.mutation(leads.updateLead, {
        leadId,
        address: {
          country: 'FR',
          streetNumber: '1',
          street: 'rue X',
          postalCode: 'nope',
          city: 'Paris',
        },
      }),
    ).rejects.toThrow('invalid_address');
  });

  test('a contact created by hand enrolls in the workflows that wait for one', async () => {
    const { t, as, emp } = await setup();
    const workflowId = await t.run((ctx) =>
      ctx.db.insert('workflows', {
        name: 'Bienvenue',
        status: 'active',
        trigger: { type: 'lead_created' },
        allowReEnrollment: true,
        nodes: [{ id: 'n1', type: 'wait', amount: 1, unit: 'hours' }],
        startNodeId: 'n1',
        enrolledCount: 0,
        activeCount: 0,
        completedCount: 0,
        updatedAt: NOW,
        createdBy: emp.userId,
      }),
    );
    const leadId = await as.mutation(leads.createLead, { firstName: 'A', lastName: 'B' });
    const runs = await t.run((ctx) =>
      ctx.db
        .query('workflowRuns')
        .withIndex('by_workflow', (q) => q.eq('workflowId', workflowId))
        .collect(),
    );
    expect(runs.map((r) => r.leadId)).toEqual([leadId]);
  });

  test('an import into a list needs a list that exists', async () => {
    const { t, as } = await setup();
    const listId = await as.mutation(api.features.leadLists.mutations.createLeadList, {
      name: 'Salon',
    });
    await t.run((ctx) => ctx.db.delete(listId));
    await expect(
      as.mutation(leads.importLeads, {
        rows: [{ firstName: 'A', lastName: 'B', email: 'a@example.com' }],
        listId,
      }),
    ).rejects.toThrow('list_not_found');
  });

  test('deleting one contact or several marks them deleted and audits each, once', async () => {
    const { t, as, emp, leadId } = await setup();
    const other = await as.mutation(leads.createLead, { firstName: 'A', lastName: 'B' });
    const third = await as.mutation(leads.createLead, { firstName: 'C', lastName: 'D' });

    await as.mutation(leads.deleteLead, { leadId });
    expect(await row(t, leadId)).toMatchObject({ deletedAt: NOW, updatedBy: emp.userId });
    await expect(as.mutation(leads.deleteLead, { leadId })).rejects.toThrow('lead_not_found');
    await expect(as.mutation(leads.updateLead, { leadId, comment: 'x' })).rejects.toThrow(
      'lead_not_found',
    );

    expect(
      await as.mutation(leads.deleteLeads, { leadIds: [other, other, third, leadId] }),
    ).toEqual({ deleted: 2 });
    for (const id of [leadId, other, third]) {
      expect((await row(t, id))?.deletedAt).toBe(NOW);
      expect((await auditsOf(t, id)).filter((a) => a.action === 'delete')).toEqual([
        { action: 'delete', entityType: 'lead', userId: emp.userId, metadata: undefined },
      ]);
    }
  });
});

describe('notes of a contact', () => {
  test('a note is written trimmed, counts as an activity, and is refused empty or on a deleted contact', async () => {
    const { t, as, emp, leadId } = await setup();
    const noteId = await as.mutation(leads.createNote, { leadId, content: '  Rappeler lundi  ' });
    expect(await row(t, noteId)).toMatchObject({
      leadId,
      content: 'Rappeler lundi',
      isPinned: false,
      createdBy: emp.userId,
      updatedAt: NOW,
    });
    expect((await row(t, leadId))?.lastActivityAt).toBe(NOW);
    expect(await auditsOf(t, noteId)).toEqual([
      { action: 'create', entityType: 'leadNote', userId: emp.userId, metadata: undefined },
    ]);

    await expect(as.mutation(leads.createNote, { leadId, content: '   ' })).rejects.toThrow(
      'empty_note',
    );
    await as.mutation(leads.deleteLead, { leadId });
    await expect(as.mutation(leads.createNote, { leadId, content: 'x' })).rejects.toThrow(
      'lead_not_found',
    );
  });

  test('a note is edited and pinned with an audit of what changed, and nothing when nothing does', async () => {
    const { t, as, emp, leadId } = await setup();
    const noteId = await as.mutation(leads.createNote, { leadId, content: 'Un' });

    // Whoever edits a note is the one it says last changed it.
    const colleague = await seedEmployee(t, { email: 'colleague@example.com' });
    await asIdentity(t, colleague.identity).mutation(leads.setNotePinned, {
      noteId,
      isPinned: false,
    });
    expect((await row(t, noteId))?.updatedBy).toBe(colleague.userId);

    expect(await as.mutation(leads.updateNote, { noteId, content: ' Deux ' })).toBe(noteId);
    expect(await row(t, noteId)).toMatchObject({ content: 'Deux', updatedBy: emp.userId });
    await as.mutation(leads.updateNote, { noteId, content: 'Deux' });
    await expect(as.mutation(leads.updateNote, { noteId, content: ' ' })).rejects.toThrow(
      'empty_note',
    );

    expect(await as.mutation(leads.setNotePinned, { noteId, isPinned: true })).toBe(noteId);
    expect((await row(t, noteId))?.isPinned).toBe(true);
    await as.mutation(leads.setNotePinned, { noteId, isPinned: true });
    await as.mutation(leads.setNotePinned, { noteId, isPinned: false });
    expect((await row(t, noteId))?.isPinned).toBe(false);

    const updates = (await auditsOf(t, noteId)).filter((a) => a.action === 'update');
    expect(updates.map((a) => a.metadata)).toEqual([
      { changes: { content: { old: 'Un', new: 'Deux' } } },
      { changes: { isPinned: { old: false, new: true } } },
      { changes: { isPinned: { old: true, new: false } } },
    ]);
    expect(updates.every((a) => a.entityType === 'leadNote' && a.userId === emp.userId)).toBe(true);
  });

  test('a deleted note can no longer be edited, pinned or deleted', async () => {
    const { t, as, emp, leadId } = await setup();
    const noteId = await as.mutation(leads.createNote, { leadId, content: 'Un' });
    await as.mutation(leads.deleteNote, { noteId });
    expect(await row(t, noteId)).toMatchObject({ deletedAt: NOW, updatedBy: emp.userId });
    expect((await auditsOf(t, noteId)).at(-1)).toEqual({
      action: 'delete',
      entityType: 'leadNote',
      userId: emp.userId,
      metadata: undefined,
    });
    await expect(as.mutation(leads.updateNote, { noteId, content: 'x' })).rejects.toThrow(
      'note_not_found',
    );
    await expect(as.mutation(leads.setNotePinned, { noteId, isPinned: true })).rejects.toThrow(
      'note_not_found',
    );
    await expect(as.mutation(leads.deleteNote, { noteId })).rejects.toThrow('note_not_found');
    expect((await auditsOf(t, noteId)).filter((a) => a.action === 'delete')).toHaveLength(1);
  });
});
