import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { TimelineEvent } from '../../convex/features/timeline/queries';
import type { TimelineKind } from '../../convex/_lib/validators/timeline';
import { asIdentity, createTestConvex, seedEmployee } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

type Page = { page: TimelineEvent[]; isDone: boolean; continueCursor: string };

/** A lead with at least one event of every kind (14 events in total). */
async function seedTimeline() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  // → audit 'create' + initial lifecycle row
  const leadId = await as.mutation(api.features.crm.mutations.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
    email: 'jean@dupont.fr',
    ownerIds: [emp.userId],
  });
  for (const content of ['Première note', 'Deuxième note', 'Troisième note']) {
    await as.mutation(api.features.crm.mutations.createNote, { leadId, content });
  }
  await as.mutation(api.features.activities.mutations.createActivity, {
    type: 'task',
    title: 'Relancer',
    leadId,
    dueAt: Date.now() + DAY,
  });
  await as.mutation(api.features.activities.mutations.logCall, {
    leadId,
    outcome: 'Répondu',
  });
  const { campaignId, sendId } = await t.run(async (ctx) => {
    const campaignId = await ctx.db.insert('campaigns', {
      name: 'Newsletter',
      status: 'sent',
      channel: 'email',
      totalCount: 1,
      sentCount: 1,
      failedCount: 0,
      updatedAt: Date.now(),
    });
    const sendId = await ctx.db.insert('campaignSends', {
      campaignId,
      leadId,
      email: 'jean@dupont.fr',
      params: {},
      status: 'sent',
      sentAt: Date.now(),
    });
    return { campaignId, sendId };
  });
  // Event stamps come from Brevo: put them a little after the send.
  const eventBase = Date.now() + 1000;
  await t.run(async (ctx) => {
    await ctx.db.insert('campaignEvents', {
      campaignId,
      sendId,
      leadId,
      type: 'delivered',
      eventAt: eventBase,
    });
    await ctx.db.insert('campaignEvents', {
      campaignId,
      sendId,
      leadId,
      type: 'opened',
      eventAt: eventBase + 500,
    });
  });
  const workflowId = await as.mutation(api.features.workflows.mutations.createWorkflow, {
    name: 'Bienvenue',
    trigger: { type: 'consent_updated' },
    allowReEnrollment: true,
    nodes: [{ id: 'n1', type: 'create_task', title: 'Appeler' }],
    startNodeId: 'n1',
  });
  await t.run((ctx) =>
    ctx.db.insert('workflowRuns', {
      workflowId,
      leadId,
      status: 'completed',
      triggerType: 'manual',
      manual: true,
      enrolledAt: Date.now(),
      finishedAt: Date.now(),
      stepCount: 1,
    }),
  );
  await as.mutation(api.features.deals.mutations.ensureDefaultPipeline, {});
  await as.mutation(api.features.deals.mutations.createDeal, {
    title: 'Contrat annuel',
    amount: 1200,
    leadId,
  });
  // → audit 'update' + lifecycle transition
  await as.mutation(api.features.crm.mutations.updateLead, {
    leadId,
    phone: '+33612345678',
    lifecycleStage: 'mql',
  });
  return { t, as, emp, leadId };
}

async function readAllPages(
  as: ReturnType<typeof asIdentity>,
  leadId: Id<'leads'>,
  numItems: number,
  kinds?: TimelineKind[],
): Promise<{ events: TimelineEvent[]; pages: Page[] }> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const page: Page = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId,
      kinds,
      paginationOpts: { numItems, cursor },
    });
    pages.push(page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return { events: pages.flatMap((p) => p.page), pages };
}

describe('lead timeline', () => {
  test('merges every source newest first, paged without loss nor duplicates', async () => {
    const { as, leadId } = await seedTimeline();
    const { events, pages } = await readAllPages(as, leadId, 3);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages[pages.length - 1].isDone).toBe(true);
    // Every page but the last carries at least the requested number of rows.
    for (const page of pages.slice(0, -1)) expect(page.page.length).toBeGreaterThanOrEqual(3);

    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.length).toBe(14);
    for (let i = 1; i < events.length; i++)
      expect(events[i - 1].at).toBeGreaterThanOrEqual(events[i].at);

    const kinds = new Set(events.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(
      [
        'activity',
        'audit',
        'campaign_event',
        'campaign_send',
        'deal',
        'lifecycle',
        'note',
        'workflow_run',
      ].sort(),
    );

    // Same content whatever the page size.
    const { events: all } = await readAllPages(as, leadId, 50);
    expect(all.map((e) => e.id)).toEqual(ids);
  });

  test('events carry what the feed displays', async () => {
    const { as, leadId } = await seedTimeline();
    const { events } = await readAllPages(as, leadId, 50);
    const of = <K extends TimelineKind>(kind: K) =>
      events.filter((e): e is Extract<TimelineEvent, { kind: K }> => e.kind === kind);

    expect(of('note').map((n) => n.content)).toEqual([
      'Troisième note',
      'Deuxième note',
      'Première note',
    ]);
    expect(of('note')[0].authorName).toBe('Test User');
    expect(of('activity').map((a) => [a.type, a.status])).toEqual([
      ['call', 'done'],
      ['task', 'open'],
    ]);
    expect(of('campaign_send')[0]).toMatchObject({
      campaignName: 'Newsletter',
      channel: 'email',
      status: 'sent',
    });
    expect(of('campaign_event').map((e) => e.type)).toEqual(['opened', 'delivered']);
    expect(of('workflow_run')[0]).toMatchObject({
      workflowName: 'Bienvenue',
      status: 'completed',
      manual: true,
    });
    expect(of('deal')[0]).toMatchObject({ title: 'Contrat annuel', amount: 1200, status: 'open' });
    expect(of('deal')[0].stageLabel).not.toBeNull();
    expect(of('lifecycle').map((l) => [l.from, l.to])).toEqual([
      ['lead', 'mql'],
      [null, 'lead'],
    ]);
    const audits = of('audit');
    expect(audits.map((a) => a.action)).toEqual(['update', 'create']);
    expect(audits[0].fields.sort()).toEqual(['lifecycleStage', 'phone']);
    expect(audits[0].userName).toBe('Test User');
    // Campaign events are ordered by their Brevo stamp, after the send they belong to.
    const sendIndex = events.findIndex((e) => e.kind === 'campaign_send');
    const eventIndex = events.findIndex((e) => e.kind === 'campaign_event');
    expect(eventIndex).toBeLessThan(sendIndex);
  });

  test('kinds restricts the sources read', async () => {
    const { as, leadId } = await seedTimeline();
    const { events } = await readAllPages(as, leadId, 2, ['note', 'activity']);
    expect(events.map((e) => e.kind)).toEqual(['activity', 'activity', 'note', 'note', 'note']);
  });

  test('a pinned page (endCursor) re-reads the same rows and grows with new ones on top', async () => {
    const { as, leadId } = await seedTimeline();
    const first: Page = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId,
      paginationOpts: { numItems: 4, cursor: null },
    });
    const pinned = () =>
      as.query(api.features.timeline.queries.listLeadTimeline, {
        leadId,
        paginationOpts: { numItems: 4, cursor: null, endCursor: first.continueCursor },
      }) as Promise<Page>;
    expect((await pinned()).page.map((e) => e.id)).toEqual(first.page.map((e) => e.id));

    const noteId = await as.mutation(api.features.crm.mutations.createNote, {
      leadId,
      content: 'Nouvelle note',
    });
    const grown = await pinned();
    // The note lands in the pinned window (below the future-stamped campaign events).
    expect(grown.page.map((e) => e.id)).toContain(noteId);
    expect(grown.page.filter((e) => e.id !== noteId).map((e) => e.id)).toEqual(
      first.page.map((e) => e.id),
    );
    expect(grown.continueCursor).toBe(first.continueCursor);

    // The next page is untouched by the insert.
    const second: Page = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId,
      paginationOpts: { numItems: 4, cursor: first.continueCursor },
    });
    expect(second.page.every((e) => e.at < first.page[first.page.length - 1].at)).toBe(true);
    expect(second.page.some((e) => e.id === noteId)).toBe(false);
  });

  test('exhausted sources are dropped from the cursor; deleted rows and leads disappear', async () => {
    const { t, as, leadId } = await seedTimeline();
    const { pages } = await readAllPages(as, leadId, 3);
    const done = JSON.parse(pages[0].continueCursor).done as string[];
    // One send, one run, one deal: all read on the first page… but only sources
    // whose rows were all emitted are marked done.
    expect(done.length).toBeGreaterThan(0);
    for (const kind of done) {
      expect(
        pages
          .slice(1)
          .flatMap((p) => p.page)
          .some((e) => e.kind === kind),
      ).toBe(false);
    }

    const { events: before } = await readAllPages(as, leadId, 50);
    const note = before.find((e) => e.kind === 'note');
    if (!note || note.kind !== 'note') throw new Error('note expected');
    await as.mutation(api.features.crm.mutations.deleteNote, { noteId: note.noteId });
    const { events: after } = await readAllPages(as, leadId, 50);
    expect(after.map((e) => e.id)).not.toContain(note.id);
    expect(after.length).toBe(before.length - 1);

    await t.run((ctx) => ctx.db.patch(leadId, { deletedAt: Date.now() }));
    const gone: Page = await as.query(api.features.timeline.queries.listLeadTimeline, {
      leadId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(gone).toEqual({ page: [], isDone: true, continueCursor: '' });
  });
});
