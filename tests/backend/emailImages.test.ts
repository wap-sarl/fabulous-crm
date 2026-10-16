import { beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { DAY_MS } from '../../convex/_lib/time';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  runAll,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.parse('2026-10-16T12:00:00Z');
beforeEach(() => {
  pinClock(NOW);
  // The campaign of the claim test needs an e-mail provider.
  process.env.BREVO_API_KEY = 'test-brevo-key';
});

async function setup() {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t);
  return { t, as: asIdentity(t, admin.identity), asMember: asIdentity(t, member.identity) };
}

const register = api.features.attachments.mutations.registerEmailImage;

/** A blob in the test store, which keeps no content type: the declared one stands in, as the mutation allows. */
async function image(t: T, contentType: string, bytes = 4) {
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array(bytes)], { type: contentType })),
  );
  return { storageId, contentType };
}

describe('the images of an e-mail body', () => {
  test('a raster image is recorded for its uploader and served; a SVG or a heavy one is refused and its blob deleted', async () => {
    const { t, as } = await setup();
    const kept = await as.mutation(register, await image(t, 'image/png'));
    if (!kept.ok) throw new Error('refused');
    expect(kept.url).toMatch(/^https?:\/\//);
    expect((await t.run((ctx) => ctx.db.get(kept.imageId)))?.contentType).toBe('image/png');
    const svg = await image(t, 'image/svg+xml');
    expect(await as.mutation(register, svg)).toEqual({ ok: false, code: 'type' });
    expect(await t.run((ctx) => ctx.db.system.get(svg.storageId))).toBeNull();
    const heavy = await image(t, 'image/jpeg', 5 * 1024 * 1024 + 1);
    expect(await as.mutation(register, heavy)).toEqual({ ok: false, code: 'too_large' });
    expect(await t.run((ctx) => ctx.db.system.get(heavy.storageId))).toBeNull();
  });

  test("a blob that is a record's file, or already registered, cannot be registered", async () => {
    const { t, as } = await setup();
    const { storageId } = await image(t, 'image/png');
    const leadId = await as.mutation(api.features.leads.mutations.createLead, {
      firstName: 'Ada',
      lastName: 'L',
      email: 'ada@example.com',
    });
    await t.run((ctx) =>
      ctx.db.insert('attachments', {
        entityType: 'lead',
        entityId: leadId,
        folder: '',
        name: 'scan.png',
        mimeType: 'image/png',
        size: 4,
        provider: 'convex',
        storageId,
        key: `lead/${leadId}/scan.png`,
        updatedAt: NOW,
      }),
    );
    await expect(as.mutation(register, { storageId, contentType: 'image/png' })).rejects.toThrow(
      /email_image_not_found/,
    );
    const other = await image(t, 'image/png');
    await as.mutation(register, other);
    await expect(as.mutation(register, other)).rejects.toThrow(/email_image_not_found/);
  });

  test("a campaign claims its images, only the uploader's own; the unclaimed ones go with their blobs after a day", async () => {
    const { t, as, asMember } = await setup();
    const kept = async (caller: typeof as, blob: Awaited<ReturnType<typeof image>>) => {
      const result = await caller.mutation(register, blob);
      if (!result.ok) throw new Error('refused');
      return result;
    };
    const mine = await kept(as, await image(t, 'image/png'));
    const theirs = await kept(asMember, await image(t, 'image/png'));
    const orphanBlob = await image(t, 'image/gif');
    const orphan = await kept(as, orphanBlob);
    // The member's own campaign: the claim reaches their image, not the admin's.
    const campaignId = await asMember.mutation(api.features.campaigns.mutations.createCampaign, {
      name: 'Visuel',
      channel: 'email',
      filter: {},
      subject: 'Hi',
      htmlBody: `<img src="${mine.url}">`,
      messageType: 'transactional',
    });
    await asMember.mutation(api.features.attachments.mutations.claimEmailImages, {
      campaignId,
      imageIds: [mine.imageId, theirs.imageId],
    });
    const claimed = await t.run(async (ctx) => [
      (await ctx.db.get(mine.imageId))?.campaignId ?? null,
      (await ctx.db.get(theirs.imageId))?.campaignId ?? null,
      (await ctx.db.get(orphan.imageId))?.campaignId ?? null,
    ]);
    // The member reaches their own image only; the admin's stays unclaimed by them.
    expect(claimed).toEqual([null, campaignId, null]);
    await as.mutation(api.features.attachments.mutations.claimEmailImages, {
      campaignId,
      imageIds: [mine.imageId],
    });
    pinClock(NOW + 2 * DAY_MS);
    await t.mutation(internal.features.retention.internal.runPurge, {});
    await runAll(t, NOW + 2 * DAY_MS);
    const left = await t.run((ctx) => ctx.db.query('emailImages').collect());
    expect(left.map((i) => i._id).sort()).toEqual([mine.imageId, theirs.imageId].sort());
    expect(await t.run((ctx) => ctx.db.system.get(orphanBlob.storageId))).toBeNull();
  });
});
