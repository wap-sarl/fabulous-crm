import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { wrapEmailHtml } from '../../convex/lib/email/brevo';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  seedLead,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const campaigns = api.features.campaigns.queries;
const zeroStats = {
  pending: 0,
  skipped: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  replied: 0,
  unsubscribed: 0,
  bounced: 0,
  sentByHour: {},
};

type World = { t: T; as: ReturnType<typeof asIdentity>; userId: Id<'users'> };

async function setup(): Promise<World> {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'agent@example.com' });
  return { t, as: asIdentity(t, emp.identity), userId: emp.userId };
}

const insertCampaign = (w: World, overrides: Partial<Doc<'campaigns'>> = {}) =>
  w.t.run((ctx) =>
    ctx.db.insert('campaigns', {
      name: 'Relance',
      channel: 'email',
      status: 'sent',
      totalCount: 0,
      sentCount: 0,
      failedCount: 0,
      updatedAt: NOW,
      createdBy: w.userId,
      ...overrides,
    }),
  );

const insertSend = (
  w: World,
  campaignId: Id<'campaigns'>,
  leadId: Id<'leads'>,
  overrides: Partial<Doc<'campaignSends'>> = {},
) =>
  w.t.run((ctx) =>
    ctx.db.insert('campaignSends', {
      campaignId,
      leadId,
      params: {},
      status: 'sent',
      ...overrides,
    }),
  );

const insertEvent = (
  w: World,
  send: { campaignId: Id<'campaigns'>; sendId: Id<'campaignSends'>; leadId: Id<'leads'> },
  type: Doc<'campaignEvents'>['type'],
  eventAt: number,
  extra: Partial<Doc<'campaignEvents'>> = {},
) => w.t.run((ctx) => ctx.db.insert('campaignEvents', { ...send, type, eventAt, ...extra }));

const trackedLink = {
  key: 'oui',
  label: 'Oui',
  target: { kind: 'standard' as const, field: 'comment' as const },
  value: 'intéressé',
  redirectUrl: 'https://example.com/merci',
};

describe('a campaign read with its sends', () => {
  test('a campaign that is gone, or deleted, reads as nothing', async () => {
    const w = await setup();
    const gone = await insertCampaign(w);
    await w.t.run((ctx) => ctx.db.delete(gone));
    const deleted = await insertCampaign(w, { deletedAt: NOW });

    expect(await w.as.query(campaigns.getCampaign, { campaignId: gone })).toBeNull();
    expect(await w.as.query(campaigns.getCampaign, { campaignId: deleted })).toBeNull();
    expect(await w.as.query(campaigns.getCampaignStats, { campaignId: gone })).toBeNull();
    expect(await w.as.query(campaigns.getCampaignStats, { campaignId: deleted })).toBeNull();
  });

  test('an e-mail written in the CRM is shown with its counts, its counters and its message as authored; its sends come by pages', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, { email: 'ada@example.com' });
    const campaignId = await insertCampaign(w, {
      subject: 'Bonjour {{ params.firstName }}',
      htmlBody: '<p>Bonjour {{ params.firstName }}, <a href="{{ params.oui }}">oui</a></p>',
      messageType: 'marketing',
      trackedLinks: [trackedLink],
      emailProvider: 'smtp',
      failureReason: 'quota_exceeded',
      totalCount: 3,
      sentCount: 1,
      failedCount: 2,
      updatedBy: w.userId,
    });
    const sent = await insertSend(w, campaignId, leadId, {
      email: 'ada@example.com',
      params: { firstName: 'Ada', lastName: 'Lovelace', oui: 'https://example.com/l/abc' },
      brevoMessageId: '<m-1@example.com>',
      sentAt: NOW,
      openedAt: NOW + 1,
      clickedAt: NOW + 2,
    });
    const failed = await insertSend(w, campaignId, leadId, {
      email: 'ada@example.com',
      status: 'failed',
      error: 'mailbox unavailable',
      sentAt: NOW,
    });
    const skipped = await insertSend(w, campaignId, leadId, { status: 'skipped_no_email' });
    await insertSend(w, await insertCampaign(w), leadId);

    const result = await w.as.query(campaigns.getCampaign, { campaignId });
    expect(result?.campaign).toMatchObject({
      _id: campaignId,
      name: 'Relance',
      channel: 'email',
      status: 'sent',
      messageType: 'marketing',
      trackedLinks: [trackedLink],
      emailProvider: 'smtp',
      failureReason: 'quota_exceeded',
      totalCount: 3,
      sentCount: 1,
      failedCount: 2,
      createdBy: w.userId,
      updatedBy: w.userId,
    });
    // The counters as stored, their rows summed: the sends are not read to make them.
    const insertShard = (shard: number, stats: Partial<typeof zeroStats>) =>
      w.t.run((ctx) =>
        ctx.db.insert('campaignStatShards', {
          campaignId,
          shard,
          stats: { ...zeroStats, ...stats },
        }),
      );
    await insertShard(0, { opened: 2, sentByHour: { [String(NOW)]: 3 } });
    // A row holds changes and may be below zero; a sum below zero, which no count leaves, reads zero.
    await insertShard(9, {
      opened: -1,
      clicked: 1,
      bounced: -2,
      sentByHour: { [String(NOW)]: -1, [String(NOW + 3_600_000)]: -1 },
    });
    expect(await w.as.query(campaigns.getCampaignStats, { campaignId })).toEqual({
      ...zeroStats,
      opened: 1,
      clicked: 1,
      sentByHour: { [String(NOW)]: 2 },
    });
    const sends = await w.as.query(campaigns.listCampaignSends, {
      campaignId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(sends.page.map((s) => [s._id, s.status])).toEqual([
      [sent, 'sent'],
      [failed, 'failed'],
    ]);
    expect(sends.isDone).toBe(false);
    expect(sends.page[0]).toMatchObject({
      campaignId,
      leadId,
      email: 'ada@example.com',
      params: { firstName: 'Ada', lastName: 'Lovelace', oui: 'https://example.com/l/abc' },
      brevoMessageId: '<m-1@example.com>',
      sentAt: NOW,
      openedAt: NOW + 1,
      clickedAt: NOW + 2,
    });
    expect(sends.page[1].error).toBe('mailbox unavailable');
    const rest = await w.as.query(campaigns.listCampaignSends, {
      campaignId,
      paginationOpts: { numItems: 2, cursor: sends.continueCursor },
    });
    expect(rest.page.map((s) => [s._id, s.status])).toEqual([[skipped, 'skipped_no_email']]);
    expect(rest.isDone).toBe(true);
    // Nobody in particular reads it: the placeholders stay as they were written.
    expect(result?.messagePreview).toEqual({
      channel: 'email',
      subject: 'Bonjour {{ params.firstName }}',
      html: wrapEmailHtml(
        '<p>Bonjour {{ params.firstName }}, <a href="{{ params.oui }}">oui</a></p>',
      ),
    });
  });

  test('an e-mail from a Brevo template shows the number of the template, and nothing of its content; a campaign older than the counters reads zeros', async () => {
    const w = await setup();
    const campaignId = await insertCampaign(w, { brevoTemplateId: 42, messageType: 'marketing' });

    const result = await w.as.query(campaigns.getCampaign, { campaignId });
    expect(result?.campaign.brevoTemplateId).toBe(42);
    expect(await w.as.query(campaigns.getCampaignStats, { campaignId })).toEqual(zeroStats);
    expect(result?.messagePreview).toEqual({ channel: 'email', templateId: 42 });
  });

  test('a text message campaign shows its text, and its sends the number and what the operator reported', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, { phone: '+33612345678' });
    const campaignId = await insertCampaign(w, {
      channel: 'sms',
      smsBody: 'Bonjour {{ params.firstName }}, STOP au 36111',
      messageType: 'transactional',
      totalCount: 1,
      sentCount: 1,
    });
    const sendId = await insertSend(w, campaignId, leadId, {
      phone: '+33612345678',
      smsRecipient: '33612345678',
      params: { firstName: 'Ada' },
      brevoMessageId: 'sms-1',
      sentAt: NOW,
      deliveredAt: NOW + 1,
      repliedAt: NOW + 2,
      unsubscribedAt: NOW + 3,
      bouncedAt: NOW + 4,
    });

    const result = await w.as.query(campaigns.getCampaign, { campaignId });
    expect(result?.campaign).toMatchObject({ channel: 'sms', messageType: 'transactional' });
    const sends = await w.as.query(campaigns.listCampaignSends, {
      campaignId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(sends.page).toHaveLength(1);
    expect(sends.page[0]).toMatchObject({
      _id: sendId,
      phone: '+33612345678',
      smsRecipient: '33612345678',
      deliveredAt: NOW + 1,
      repliedAt: NOW + 2,
      unsubscribedAt: NOW + 3,
      bouncedAt: NOW + 4,
    });
    expect(result?.messagePreview).toEqual({
      channel: 'sms',
      sms: 'Bonjour {{ params.firstName }}, STOP au 36111',
    });
  });

  test('a campaign with no message has a preview that only says its channel, e-mail when it was written before channels', async () => {
    const w = await setup();
    const legacy = await insertCampaign(w, { channel: undefined, createdBy: undefined });
    const emptySms = await insertCampaign(w, { channel: 'sms', status: 'draft' });

    const email = await w.as.query(campaigns.getCampaign, { campaignId: legacy });
    expect(email?.campaign.channel).toBeUndefined();
    expect(email?.messagePreview).toEqual({
      channel: 'email',
      subject: undefined,
      html: undefined,
    });
    const sms = await w.as.query(campaigns.getCampaign, { campaignId: emptySms });
    expect(sms?.messagePreview).toEqual({ channel: 'sms', sms: undefined });
  });
});

describe('the list of campaigns', () => {
  const list = (
    w: World,
    args: {
      status?: Doc<'campaigns'>['status'];
      search?: string;
      numItems?: number;
      cursor?: string | null;
    } = {},
  ) =>
    w.as.query(campaigns.listCampaigns, {
      status: args.status,
      search: args.search,
      paginationOpts: { numItems: args.numItems ?? 10, cursor: args.cursor ?? null },
    });

  test('the campaigns come newest first, by pages, with their counts and nothing of their content', async () => {
    const w = await setup();
    // Dropped from its page, which runs short of it.
    await insertCampaign(w, { name: 'Effacée', deletedAt: NOW });
    const first = await insertCampaign(w, {
      name: 'Première',
      htmlBody: '<p>lourd</p>',
      totalCount: 3,
      sentCount: 2,
      failedCount: 1,
    });
    const second = await insertCampaign(w, { name: 'Deuxième', channel: 'sms', status: 'draft' });
    const third = await insertCampaign(w, { name: 'Troisième' });

    const page = await list(w, { numItems: 2 });
    expect(page.page).toEqual([
      expect.objectContaining({ _id: third, name: 'Troisième', status: 'sent' }),
      expect.objectContaining({ _id: second, channel: 'sms', status: 'draft' }),
    ]);
    expect(page.isDone).toBe(false);
    const rest = await list(w, { numItems: 2, cursor: page.continueCursor });
    expect(rest.page).toEqual([
      {
        _id: first,
        _creationTime: expect.any(Number),
        name: 'Première',
        channel: 'email',
        status: 'sent',
        totalCount: 3,
        sentCount: 2,
        failedCount: 1,
      },
    ]);
    expect(rest.isDone).toBe(true);
  });

  test('a status narrows the pages, a typed name finds the campaigns called so, together or not', async () => {
    const w = await setup();
    const relance = await insertCampaign(w, { name: 'Relance printemps', status: 'sent' });
    const brouillon = await insertCampaign(w, { name: 'Relance été', status: 'draft' });
    await insertCampaign(w, { name: 'Bienvenue', status: 'sent' });
    await insertCampaign(w, { name: 'Relance effacée', status: 'draft', deletedAt: NOW });

    expect((await list(w, { status: 'draft' })).page.map((c) => c._id)).toEqual([brouillon]);
    expect((await list(w, { search: 'relance' })).page.map((c) => c._id)).toEqual(
      expect.arrayContaining([relance, brouillon]),
    );
    expect((await list(w, { search: 'relance' })).page).toHaveLength(2);
    expect((await list(w, { search: 'relance', status: 'sent' })).page.map((c) => c._id)).toEqual([
      relance,
    ]);
    expect((await list(w, { search: 'nulle part' })).page).toEqual([]);
  });

  test('a picker gets ten choices at most, by name, on one channel, the chosen one kept whatever the search', async () => {
    const w = await setup();
    const sms = await insertCampaign(w, { name: 'Alerte SMS', channel: 'sms' });
    const legacy = await insertCampaign(w, { name: 'Alerte ancienne', channel: undefined });
    const ids: Id<'campaigns'>[] = [];
    for (let i = 0; i < 12; i++) ids.push(await insertCampaign(w, { name: `Lettre ${i}` }));
    const gone = await insertCampaign(w, { name: 'Alerte effacée', deletedAt: NOW });
    const search = (args: {
      search?: string;
      channel?: 'email' | 'sms';
      selected?: Id<'campaigns'>;
    }) => w.as.query(campaigns.searchCampaigns, args);

    const recent = await search({});
    expect(recent).toHaveLength(10);
    expect(recent[0]).toEqual({ _id: ids[11], name: 'Lettre 11', channel: 'email' });
    expect((await search({ search: 'alerte' })).map((c) => c._id)).toEqual(
      expect.arrayContaining([sms, legacy]),
    );
    expect((await search({ search: 'alerte' })).map((c) => c._id)).not.toContain(gone);
    // A campaign written before channels is an e-mail one.
    expect((await search({ search: 'alerte', channel: 'email' })).map((c) => c._id)).toEqual([
      legacy,
    ]);
    expect((await search({ search: 'alerte', channel: 'sms' })).map((c) => c._id)).toEqual([sms]);
    const kept = (await search({ search: 'lettre', selected: sms })).map((c) => c._id);
    expect(kept[0]).toBe(sms);
    expect(kept).toHaveLength(11);
    expect(ids).toEqual(expect.arrayContaining(kept.slice(1)));
    expect((await search({ selected: gone })).map((c) => c._id)).not.toContain(gone);
  });
});

describe('the events of a campaign', () => {
  test('a campaign nothing happened to has an empty page', async () => {
    const w = await setup();
    const campaignId = await insertCampaign(w);

    const result = await w.as.query(campaigns.listCampaignEvents, {
      campaignId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
  });

  test('the events come most recent first, each with what its kind carries and who it reached, without those of another campaign', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const campaignId = await insertCampaign(w);
    const sendId = await insertSend(w, campaignId, leadId, {
      email: 'ada@example.com',
      params: { firstName: 'Ada', lastName: 'Lovelace' },
    });
    const send = { campaignId, sendId, leadId };
    await insertEvent(w, send, 'delivered', NOW + 1);
    await insertEvent(w, send, 'opened', NOW + 2);
    await insertEvent(w, send, 'clicked', NOW + 3, { url: 'https://example.com/offre' });
    await insertEvent(w, send, 'link_click', NOW + 4, { linkKey: 'oui', linkLabel: 'Oui' });
    await insertEvent(w, send, 'hard_bounce', NOW + 5, { reason: 'mailbox full' });
    await insertEvent(w, send, 'sms_reply', NOW + 6);
    const other = await insertCampaign(w);
    const otherSend = await insertSend(w, other, leadId);
    await insertEvent(w, { campaignId: other, sendId: otherSend, leadId }, 'spam', NOW + 7);

    const result = await w.as.query(campaigns.listCampaignEvents, {
      campaignId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(result.isDone).toBe(true);
    expect(
      result.page.map((e) => [e.type, e.eventAt, e.url ?? e.linkKey ?? e.reason ?? null]),
    ).toEqual([
      ['sms_reply', NOW + 6, null],
      ['hard_bounce', NOW + 5, 'mailbox full'],
      ['link_click', NOW + 4, 'oui'],
      ['clicked', NOW + 3, 'https://example.com/offre'],
      ['opened', NOW + 2, null],
      ['delivered', NOW + 1, null],
    ]);
    expect(result.page[2]).toMatchObject({
      campaignId,
      sendId,
      leadId,
      linkKey: 'oui',
      linkLabel: 'Oui',
      recipient: { name: 'Ada Lovelace', contact: 'ada@example.com' },
    });
    // A send with no merge values is shown by its address; one that is gone by nothing.
    const bare = await insertSend(w, campaignId, leadId, { phone: '+33612345678' });
    await insertEvent(w, { campaignId, sendId: bare, leadId }, 'delivered', NOW + 8);
    await w.t.run((ctx) => ctx.db.delete(sendId));
    const again = await w.as.query(campaigns.listCampaignEvents, {
      campaignId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(again.page.map((e) => e.recipient)).toEqual([
      { name: '', contact: '+33612345678' },
      { name: '', contact: '' },
    ]);
  });

  test('a page ends where the next one starts, until the last', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const campaignId = await insertCampaign(w);
    const sendId = await insertSend(w, campaignId, leadId);
    for (let i = 1; i <= 3; i++) {
      await insertEvent(w, { campaignId, sendId, leadId }, 'opened', NOW + i);
    }

    const first = await w.as.query(campaigns.listCampaignEvents, {
      campaignId,
      paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page.map((e) => e.eventAt)).toEqual([NOW + 3, NOW + 2]);
    expect(first.isDone).toBe(false);

    const last = await w.as.query(campaigns.listCampaignEvents, {
      campaignId,
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(last.page.map((e) => e.eventAt)).toEqual([NOW + 1]);
    expect(last.isDone).toBe(true);
  });
});

describe('what one recipient received', () => {
  test('a send that is gone, or whose campaign was deleted, has no preview', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const deleted = await insertCampaign(w, { deletedAt: NOW });
    const ofDeleted = await insertSend(w, deleted, leadId);
    const gone = await insertSend(w, await insertCampaign(w), leadId);
    await w.t.run((ctx) => ctx.db.delete(gone));

    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId: gone })).toBeNull();
    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId: ofDeleted })).toBeNull();
  });

  test('an e-mail written in the CRM is shown as the recipient got it, with its events most recent first', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, { email: 'ada@example.com' });
    const campaignId = await insertCampaign(w, {
      subject: 'Bonjour {{ params.firstName }} {{ params.lastName }}',
      htmlBody: '<p>{{ params.lastName }}, <a href="{{ params.oui }}">oui</a> {{ params.x }}</p>',
      trackedLinks: [trackedLink],
    });
    const params = { firstName: 'Ada', lastName: 'Lovelace & Co', oui: 'https://example.com/l/a' };
    const sendId = await insertSend(w, campaignId, leadId, {
      email: 'ada@example.com',
      phone: '+33612345678',
      params,
      brevoMessageId: '<m-1@example.com>',
      sentAt: NOW,
      openedAt: NOW + 1,
      clickedAt: NOW + 3,
    });
    const send = { campaignId, sendId, leadId };
    const opened = await insertEvent(w, send, 'opened', NOW + 1);
    const clicked = await insertEvent(w, send, 'link_click', NOW + 3, {
      linkKey: 'oui',
      linkLabel: 'Oui',
    });
    const delivered = await insertEvent(w, send, 'delivered', NOW + 2);

    const preview = await w.as.query(campaigns.getCampaignSendPreview, { sendId });
    expect(preview).toEqual({
      channel: 'email',
      // A value is escaped in the body, where it could inject markup, and not in the subject.
      subject: 'Bonjour Ada Lovelace & Co',
      html: wrapEmailHtml(
        '<p>Lovelace &amp; Co, <a href="https://example.com/l/a">oui</a> {{ params.x }}</p>',
      ),
      leadName: 'Ada Lovelace & Co',
      contact: 'ada@example.com',
      status: 'sent',
      sentAt: NOW,
      openedAt: NOW + 1,
      clickedAt: NOW + 3,
      error: undefined,
      params,
      events: [
        expect.objectContaining({ _id: clicked, type: 'link_click', linkKey: 'oui' }),
        expect.objectContaining({ _id: delivered, type: 'delivered', eventAt: NOW + 2 }),
        expect.objectContaining({ _id: opened, type: 'opened', eventAt: NOW + 1 }),
      ],
    });
  });

  test('an e-mail from a Brevo template shows the number of the template, and why it failed', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const campaignId = await insertCampaign(w, { brevoTemplateId: 42 });
    const sendId = await insertSend(w, campaignId, leadId, {
      email: 'ada@example.com',
      params: { firstName: 'Ada' },
      status: 'failed',
      error: 'template not found',
      sentAt: NOW,
    });

    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId })).toEqual({
      channel: 'email',
      templateId: 42,
      leadName: 'Ada',
      contact: 'ada@example.com',
      status: 'failed',
      sentAt: NOW,
      openedAt: undefined,
      clickedAt: undefined,
      error: 'template not found',
      params: { firstName: 'Ada' },
      events: [],
    });
  });

  test('a text message is shown as it was sent, to the number it was sent to', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, { phone: '+33612345678' });
    const campaignId = await insertCampaign(w, {
      channel: 'sms',
      smsBody: 'Bonjour {{ params.firstName }} <3, STOP au 36111',
    });
    const params = { firstName: 'Ada & Bob', lastName: 'Lovelace' };
    const sendId = await insertSend(w, campaignId, leadId, {
      phone: '+33612345678',
      smsRecipient: '33612345678',
      params,
      sentAt: NOW,
    });
    const reply = await insertEvent(w, { campaignId, sendId, leadId }, 'sms_reply', NOW + 5);

    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId })).toEqual({
      channel: 'sms',
      sms: 'Bonjour Ada & Bob <3, STOP au 36111',
      leadName: 'Ada & Bob Lovelace',
      contact: '+33612345678',
      status: 'sent',
      sentAt: NOW,
      openedAt: undefined,
      clickedAt: undefined,
      error: undefined,
      params,
      events: [expect.objectContaining({ _id: reply, type: 'sms_reply', eventAt: NOW + 5 })],
    });
  });

  test('a send that was skipped has neither a name nor an address, and a campaign with no message nothing to show', async () => {
    const w = await setup();
    const leadId = await seedLead(w.t, {});
    const email = await insertSend(w, await insertCampaign(w, { channel: undefined }), leadId, {
      status: 'skipped_no_email',
    });
    const sms = await insertSend(w, await insertCampaign(w, { channel: 'sms' }), leadId, {
      status: 'skipped_no_phone',
    });
    const pending = await insertSend(w, await insertCampaign(w, { subject: 'Bonjour' }), leadId, {
      email: 'ada@example.com',
      status: 'pending',
    });
    const unstamped = {
      sentAt: undefined,
      openedAt: undefined,
      clickedAt: undefined,
      error: undefined,
    };

    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId: email })).toEqual({
      channel: 'email',
      subject: undefined,
      html: undefined,
      leadName: null,
      contact: null,
      status: 'skipped_no_email',
      ...unstamped,
      params: {},
      events: [],
    });
    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId: sms })).toEqual({
      channel: 'sms',
      sms: undefined,
      leadName: null,
      contact: null,
      status: 'skipped_no_phone',
      ...unstamped,
      params: {},
      events: [],
    });
    expect(await w.as.query(campaigns.getCampaignSendPreview, { sendId: pending })).toEqual({
      channel: 'email',
      subject: 'Bonjour',
      html: undefined,
      leadName: null,
      contact: 'ada@example.com',
      status: 'pending',
      ...unstamped,
      params: {},
      events: [],
    });
  });
});

describe('what the composer may offer', () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.BREVO_API_KEY;
    delete process.env.BREVO_API_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.BREVO_API_KEY;
    else process.env.BREVO_API_KEY = savedKey;
  });

  const capabilities = (w: World) =>
    w.as.query(api.features.config.queries.getEmailCapabilities, {});

  test('with no settings and no key, the e-mail goes through Brevo and nothing can be sent', async () => {
    const w = await setup();
    expect(await capabilities(w)).toEqual({
      emailProvider: 'brevo',
      smsAvailable: false,
      emailConfigured: false,
    });
  });

  test('a Brevo key, in the environment or in the settings, opens e-mail and text messages', async () => {
    const w = await setup();
    process.env.BREVO_API_KEY = 'env-key';
    expect(await capabilities(w)).toEqual({
      emailProvider: 'brevo',
      smsAvailable: true,
      emailConfigured: true,
    });

    delete process.env.BREVO_API_KEY;
    await seedConfig(w.t, { email: { provider: 'brevo', brevoApiKey: 'stored-key' } });
    expect(await capabilities(w)).toEqual({
      emailProvider: 'brevo',
      smsAvailable: true,
      emailConfigured: true,
    });
  });

  test('under SMTP the e-mail needs a host, and text messages still need a Brevo key', async () => {
    const w = await setup();
    const configId = await seedConfig(w.t, {
      email: { provider: 'smtp', smtpHost: 'smtp.example.com', smtpPort: 587 },
    });
    expect(await capabilities(w)).toEqual({
      emailProvider: 'smtp',
      smsAvailable: false,
      emailConfigured: true,
    });

    await w.t.run((ctx) =>
      ctx.db.patch(configId, { email: { provider: 'smtp', brevoApiKey: 'stored-key' } }),
    );
    expect(await capabilities(w)).toEqual({
      emailProvider: 'smtp',
      smsAvailable: true,
      emailConfigured: false,
    });
  });
});

describe('the consent page', () => {
  const consent = (t: T, token: string) =>
    t.query(api.features.consent.queries.getConsentByToken, { token });

  test('a token gives the name and the channels of its contact, and nothing else', async () => {
    const t = createTestConvex();
    await seedLead(t, {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+33612345678',
      consentToken: 'token-ada',
      marketingConsent: ['email', 'sms'],
      consentSource: 'public_link',
      consentUpdatedAt: NOW,
    });
    await seedLead(t, { firstName: 'Bob', lastName: 'Martin', consentToken: 'token-bob' });

    // No identity: the page is public, the token is the secret.
    expect(await consent(t, 'token-ada')).toEqual({
      firstName: 'Ada',
      lastName: 'Lovelace',
      marketingConsent: ['email', 'sms'],
    });
    expect(await consent(t, 'token-bob')).toEqual({
      firstName: 'Bob',
      lastName: 'Martin',
      marketingConsent: [],
    });
  });

  test('an empty token, an unknown one and that of a deleted contact give nothing', async () => {
    const t = createTestConvex();
    await seedLead(t, { consentToken: 'token-gone', deletedAt: NOW });
    await seedLead(t, { consentToken: 'token-ada' });

    expect(await consent(t, '')).toBeNull();
    expect(await consent(t, 'token-nobody')).toBeNull();
    expect(await consent(t, 'token-gone')).toBeNull();
  });
});
