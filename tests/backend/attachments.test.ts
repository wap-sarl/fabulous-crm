import { describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { attachmentKey, normalizeFolder } from '../../convex/lib/fileStorage';
import { asIdentity, createTestConvex, seedEmployee, type T } from './helpers';

async function setup() {
  const t = createTestConvex();
  const emp = await seedEmployee(t, { email: 'agent@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  const leadId = await as.mutation(api.features.crm.mutations.createLead, {
    firstName: 'Jean',
    lastName: 'Dupont',
  });
  await t.run((ctx) =>
    ctx.db.insert('appConfig', {
      organizationName: 'WAP',
      appUrl: 'http://localhost:4202',
      senderEmail: 'crm@example.com',
      senderName: 'CRM',
      auth: { magicLinkEnabled: true },
      attachments: { maxSizeBytes: 1024 },
      updatedAt: Date.now(),
    }),
  );
  return { t, emp, as, leadId };
}

/** Store a blob straight into Convex Storage (what the browser's POST does). */
const storeBlob = (t: T, bytes: number, type = 'application/pdf') =>
  t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(bytes)], { type })));

describe('attachments', () => {
  test('folder and key helpers', () => {
    expect(normalizeFolder(undefined)).toBe('');
    expect(normalizeFolder(' /Devis//2026/ ')).toBe('Devis/2026');
    expect(() => normalizeFolder('a/../b')).toThrow('invalid_folder');
    expect(attachmentKey('lead', 'abc', 'Devis/2026', 'devis.pdf')).toBe(
      'lead/abc/Devis/2026/devis.pdf',
    );
    expect(attachmentKey('deal', 'abc', '', 'x.pdf')).toBe('deal/abc/x.pdf');
  });

  test('a PDF dropped on a lead is stored, listed with its URL, previewed by key and deleted with its blob', async () => {
    const { t, as, leadId } = await setup();
    const { uploadUrl, maxSizeBytes } = await as.mutation(
      api.features.attachments.mutations.generateAttachmentUploadUrl,
      { entityType: 'lead', entityId: leadId, size: 500 },
    );
    expect(uploadUrl).toContain('http');
    expect(maxSizeBytes).toBe(1024);

    const storageId = await storeBlob(t, 500);
    const created = await as.mutation(api.features.attachments.mutations.createAttachment, {
      entityType: 'lead',
      entityId: leadId,
      storageId,
      folder: 'Devis',
      name: 'devis 2026.pdf',
      mimeType: 'application/pdf',
    });
    if (created.status !== 'ok') throw new Error('expected ok');
    const { attachmentId } = created;
    const rows = await as.query(api.features.attachments.queries.listAttachments, {
      entityType: 'lead',
      entityId: leadId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'devis 2026.pdf',
      folder: 'Devis',
      mimeType: 'application/pdf',
      size: 500,
      provider: 'convex',
      key: `lead/${leadId}/Devis/devis 2026.pdf`,
      authorName: 'Test User',
    });
    expect(rows[0].url).toContain('http');

    await as.mutation(api.features.attachments.mutations.updateAttachment, {
      attachmentId,
      folder: 'Devis/Signés',
    });
    expect((await t.run((ctx) => ctx.db.get(attachmentId)))?.key).toBe(
      `lead/${leadId}/Devis/Signés/devis 2026.pdf`,
    );

    // Deleting moves the file to the trash: hidden from the card, blob and key untouched.
    await as.mutation(api.features.attachments.mutations.deleteAttachment, { attachmentId });
    const list = (entityId: string) =>
      as.query(api.features.attachments.queries.listAttachments, { entityType: 'lead', entityId });
    const trash = (entityId: string) =>
      as.query(api.features.attachments.queries.listDeletedAttachments, {
        entityType: 'lead',
        entityId,
      });
    expect(await list(leadId)).toEqual([]);
    const trashed = await trash(leadId);
    expect(trashed).toHaveLength(1);
    expect(trashed[0]).toMatchObject({
      _id: attachmentId,
      key: `lead/${leadId}/Devis/Signés/devis 2026.pdf`,
      deletedByName: 'Test User',
      daysLeft: 30,
    });
    expect(trashed[0].url).toContain('http');
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull();
    await expect(
      as.mutation(api.features.attachments.mutations.updateAttachment, {
        attachmentId,
        name: 'x.pdf',
      }),
    ).rejects.toThrow('attachment_not_found');
    await as.mutation(api.features.attachments.mutations.restoreAttachment, { attachmentId });
    const back = await list(leadId);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ _id: attachmentId, folder: 'Devis/Signés' });
    expect((await t.run((ctx) => ctx.db.get(attachmentId)))?.deletedAt).toBeUndefined();
    expect(await trash(leadId)).toEqual([]);
    await expect(
      as.mutation(api.features.attachments.mutations.restoreAttachment, { attachmentId }),
    ).rejects.toThrow('attachment_not_deleted');

    // « Supprimer définitivement » from the trash: row and blob go together.
    await as.mutation(api.features.attachments.mutations.deleteAttachment, { attachmentId });
    await as.mutation(api.features.attachments.mutations.purgeAttachment, { attachmentId });
    expect(await t.run((ctx) => ctx.db.get(attachmentId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
    await expect(
      as.mutation(api.features.attachments.mutations.restoreAttachment, { attachmentId }),
    ).rejects.toThrow('attachment_not_found');
    const audit = await t.run((ctx) =>
      ctx.db
        .query('auditLogs')
        .withIndex('by_entity', (q) =>
          q.eq('entityType', 'attachment').eq('entityId', attachmentId),
        )
        .collect(),
    );
    expect(audit.map((a) => a.action)).toEqual([
      'create',
      'update',
      'delete',
      'update',
      'delete',
      'delete',
    ]);
    expect(audit[3].metadata).toMatchObject({ restored: true });
    expect(audit[5].metadata).toMatchObject({ purged: true });
  });

  test('a delete schedules its own purge; restore and re-delete leave the old job inert', async () => {
    const { t, as, leadId } = await setup();
    const DAY = 24 * 60 * 60 * 1000;
    const storageId = await storeBlob(t, 10);
    const created = await as.mutation(api.features.attachments.mutations.createAttachment, {
      entityType: 'lead',
      entityId: leadId,
      storageId,
      name: 'old.pdf',
    });
    if (created.status !== 'ok') throw new Error('expected ok');
    const { attachmentId } = created;
    const jobs = () =>
      t.run((ctx) =>
        ctx.db.system
          .query('_scheduled_functions')
          .collect()
          .then((rows) => rows.filter((r) => r.name.includes('purgeAttachmentAt'))),
      );
    const purge = (purgeAt: number) =>
      t.mutation(internal.features.attachments.internal.purgeAttachmentAt, {
        attachmentId,
        purgeAt,
      });

    await as.mutation(api.features.attachments.mutations.deleteAttachment, { attachmentId });
    const first = (await t.run((ctx) => ctx.db.get(attachmentId)))!;
    expect(first.purgeAt).toBeCloseTo(first.deletedAt! + 30 * DAY, -3);
    const scheduled = await jobs();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].args[0]).toMatchObject({ attachmentId, purgeAt: first.purgeAt });
    expect(scheduled[0].scheduledTime).toBe(first.purgeAt!);

    // The job runs at purgeAt; a different date (an older job) is ignored.
    expect(await purge(first.purgeAt! - 1)).toBe('skipped');
    expect(await t.run((ctx) => ctx.db.get(attachmentId))).not.toBeNull();

    // Restore, then delete again: the first job's purgeAt no longer matches.
    await as.mutation(api.features.attachments.mutations.restoreAttachment, { attachmentId });
    expect(await purge(first.purgeAt!)).toBe('skipped');
    expect((await t.run((ctx) => ctx.db.get(attachmentId)))?.purgeAt).toBeUndefined();
    await as.mutation(api.features.config.mutations.updateConfig, { attachmentsRetentionDays: 1 });
    await as.mutation(api.features.attachments.mutations.deleteAttachment, { attachmentId });
    const second = (await t.run((ctx) => ctx.db.get(attachmentId)))!;
    expect(second.purgeAt).toBeCloseTo(second.deletedAt! + DAY, -3);
    expect(second.purgeAt).not.toBe(first.purgeAt);
    expect(await jobs()).toHaveLength(2);
    expect(await purge(first.purgeAt!)).toBe('skipped');
    expect(await t.run((ctx) => ctx.db.get(attachmentId))).not.toBeNull();
    const trashed = await as.query(api.features.attachments.queries.listDeletedAttachments, {
      entityType: 'lead',
      entityId: leadId,
    });
    expect(trashed[0]).toMatchObject({ purgeAt: second.purgeAt, daysLeft: 1 });

    // The matching job purges row and blob; running it again is a no-op.
    expect(await purge(second.purgeAt!)).toBe('purged');
    expect(await t.run((ctx) => ctx.db.get(attachmentId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
    expect(await purge(second.purgeAt!)).toBe('skipped');

    // The retention setting is validated; the size cap survives a retention-only update.
    expect(
      (await as.query(api.features.attachments.queries.getAttachmentLimits, {})).retentionDays,
    ).toBe(1);
    for (const bad of [0, 366, 1.5]) {
      await expect(
        as.mutation(api.features.config.mutations.updateConfig, {
          attachmentsRetentionDays: bad,
        }),
      ).rejects.toThrow('invalid_attachment_retention');
    }
    expect(
      (await as.query(api.features.attachments.queries.getAttachmentLimits, {})).maxSizeBytes,
    ).toBe(1024);
  });

  test('an oversized file is refused before the upload and again on the stored blob', async () => {
    const { t, as, leadId } = await setup();
    await expect(
      as.mutation(api.features.attachments.mutations.generateAttachmentUploadUrl, {
        entityType: 'lead',
        entityId: leadId,
        size: 2048,
      }),
    ).rejects.toThrow('attachment_too_large:1024');

    // A client that lied about the size still cannot register the blob; it is dropped.
    const storageId = await storeBlob(t, 2048);
    expect(
      await as.mutation(api.features.attachments.mutations.createAttachment, {
        entityType: 'lead',
        entityId: leadId,
        storageId,
        name: 'big.pdf',
      }),
    ).toEqual({ status: 'too_large', maxSizeBytes: 1024 });
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeNull();
    expect(
      await as.query(api.features.attachments.queries.listAttachments, {
        entityType: 'lead',
        entityId: leadId,
      }),
    ).toEqual([]);

    // The cap is configurable; the admin config exposes it.
    await as.mutation(api.features.config.mutations.updateConfig, {
      attachmentsMaxSizeBytes: 5 * 1024 * 1024,
    });
    expect(
      (await as.query(api.features.attachments.queries.getAttachmentLimits, {})).maxSizeBytes,
    ).toBe(5 * 1024 * 1024);
    await expect(
      as.mutation(api.features.config.mutations.updateConfig, { attachmentsMaxSizeBytes: 10 }),
    ).rejects.toThrow('invalid_attachment_max_size');
  });

  test('files need a live record of the right type', async () => {
    const { t, as, leadId } = await setup();
    await expect(
      as.mutation(api.features.attachments.mutations.generateAttachmentUploadUrl, {
        entityType: 'company',
        entityId: leadId,
        size: 10,
      }),
    ).rejects.toThrow('company_not_found');
    await as.mutation(api.features.crm.mutations.deleteLead, { leadId });
    const storageId = await storeBlob(t, 10);
    await expect(
      as.mutation(api.features.attachments.mutations.createAttachment, {
        entityType: 'lead',
        entityId: leadId,
        storageId,
        name: 'x.pdf',
      }),
    ).rejects.toThrow('lead_not_found');
    expect(
      await as.query(api.features.attachments.queries.listAttachments, {
        entityType: 'lead',
        entityId: 'nope' as Id<'leads'>,
      }),
    ).toEqual([]);
  });
});
