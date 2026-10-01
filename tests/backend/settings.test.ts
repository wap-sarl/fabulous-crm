import { describe, expect, test } from 'bun:test';
import { api } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import {
  ATTACHMENT_MAX_BYTES_CEILING,
  DEFAULT_ATTACHMENT_MAX_BYTES,
} from '../../convex/_lib/validators/attachments';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 1, 9, 0, 0);
const MIB = 1024 * 1024;

async function setup(config: Partial<Doc<'appConfig'>> = {}) {
  const t = createTestConvex();
  pinClock(NOW);
  const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const as = asIdentity(t, emp.identity);
  await seedConfig(t, config);
  const update = (
    args: Parameters<typeof as.mutation<typeof api.features.config.mutations.updateConfig>>[1],
  ) => as.mutation(api.features.config.mutations.updateConfig, args);
  return { t, as, emp, update };
}

const stored = (t: T) => t.run(async (ctx) => (await ctx.db.query('appConfig').first())!);
const audits = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query('auditLogs').collect()).filter((a) => a.entityType === 'appConfig'),
  );
/** The last audit row of the settings, with its metadata as the tests read it. */
async function lastAudit(t: T) {
  const audit = (await audits(t)).at(-1);
  if (!audit) throw new Error('no audit row');
  return { ...audit, metadata: audit.metadata as { fields: string[] } & Record<string, unknown> };
}

describe('settings: the plain fields', () => {
  test('each field given is written as it is kept, the others stay, and the audit names what was given', async () => {
    const { t, emp, update } = await setup({ primaryColor: '#111111' });
    expect(
      await update({
        organizationName: 'Acme',
        appUrl: 'https://crm.acme.example///',
        senderEmail: '  CRM@Acme.Example ',
        senderName: 'Acme CRM',
        primaryColor: '#AABBCC',
        magicLinkEnabled: false,
      }),
    ).toEqual({ success: true });
    const cfg = await stored(t);
    expect(cfg).toMatchObject({
      organizationName: 'Acme',
      appUrl: 'https://crm.acme.example',
      senderEmail: 'crm@acme.example',
      senderName: 'Acme CRM',
      primaryColor: '#aabbcc',
      auth: { magicLinkEnabled: false },
      updatedAt: NOW,
      updatedBy: emp.userId,
    });
    const audit = await lastAudit(t);
    expect(audit).toMatchObject({ action: 'update', entityId: cfg._id, userId: emp.userId });
    expect(audit.metadata.fields.sort()).toEqual(
      [
        'appUrl',
        'magicLinkEnabled',
        'organizationName',
        'primaryColor',
        'senderEmail',
        'senderName',
      ].sort(),
    );

    await update({ senderName: 'Autre' });
    expect(await stored(t)).toMatchObject({
      organizationName: 'Acme',
      senderName: 'Autre',
      primaryColor: '#aabbcc',
      auth: { magicLinkEnabled: false },
    });
    expect((await lastAudit(t)).metadata.fields).toEqual(['senderName']);
    // What was never set is not invented by an update of something else.
    const untouched = await stored(t);
    for (const key of [
      'retention',
      'tracking',
      'attachments',
      'lists',
      'email',
      'connectors',
    ] as const) {
      expect(untouched[key]).toBeUndefined();
    }
  });

  test('a colour that is not #rrggbb is refused and nothing is written', async () => {
    const { t, update } = await setup({ primaryColor: '#111111' });
    for (const primaryColor of ['red', '#abc', '#1234567', 'aabbcc']) {
      await expect(update({ primaryColor, senderName: 'Autre' })).rejects.toThrow(
        'invalid_primary_color',
      );
    }
    expect(await stored(t)).toMatchObject({ primaryColor: '#111111', senderName: 'CRM' });
    expect(await audits(t)).toEqual([]);
  });

  test('a new logo or favicon removes the file it replaces, the same one is kept', async () => {
    const { t, update } = await setup();
    const blob = () => t.run((ctx) => ctx.storage.store(new Blob(['x'])));
    const exists = (id: Doc<'appConfig'>['logoStorageId']) =>
      t.run(async (ctx) => (id ? (await ctx.storage.getUrl(id)) !== null : false));
    const [logo, favicon, newLogo, newFavicon] = [
      await blob(),
      await blob(),
      await blob(),
      await blob(),
    ];

    await update({ logoStorageId: logo, faviconStorageId: favicon });
    expect(await stored(t)).toMatchObject({ logoStorageId: logo, faviconStorageId: favicon });
    await update({ logoStorageId: logo, faviconStorageId: favicon });
    expect(await exists(logo)).toBe(true);
    expect(await exists(favicon)).toBe(true);

    await update({ logoStorageId: newLogo, faviconStorageId: newFavicon });
    expect(await stored(t)).toMatchObject({ logoStorageId: newLogo, faviconStorageId: newFavicon });
    expect(await exists(logo)).toBe(false);
    expect(await exists(favicon)).toBe(false);
    expect(await exists(newLogo)).toBe(true);
    expect(await exists(newFavicon)).toBe(true);
  });

  test('without a configuration nothing can be updated', async () => {
    const t = createTestConvex();
    const emp = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
    await expect(
      asIdentity(t, emp.identity).mutation(api.features.config.mutations.updateConfig, {
        senderName: 'x',
      }),
    ).rejects.toThrow('Config not initialized');
  });
});

describe('settings: the bounded numbers', () => {
  test('the size of an attachment and how long the bin keeps it', async () => {
    const { t, update } = await setup();
    for (const attachmentsMaxSizeBytes of [MIB - 1, ATTACHMENT_MAX_BYTES_CEILING + 1, MIB + 0.5]) {
      await expect(update({ attachmentsMaxSizeBytes })).rejects.toThrow(
        'invalid_attachment_max_size',
      );
    }
    for (const attachmentsRetentionDays of [0, 366, 1.5]) {
      await expect(update({ attachmentsRetentionDays })).rejects.toThrow(
        'invalid_attachment_retention',
      );
    }
    expect((await stored(t)).attachments).toBeUndefined();

    // The days alone: the size takes its default.
    await update({ attachmentsRetentionDays: 30 });
    expect((await stored(t)).attachments).toEqual({
      maxSizeBytes: DEFAULT_ATTACHMENT_MAX_BYTES,
      retentionDays: 30,
    });
    await update({ attachmentsMaxSizeBytes: MIB });
    expect((await stored(t)).attachments).toEqual({ maxSizeBytes: MIB, retentionDays: 30 });
    await update({
      attachmentsMaxSizeBytes: ATTACHMENT_MAX_BYTES_CEILING,
      attachmentsRetentionDays: 365,
    });
    expect((await stored(t)).attachments).toEqual({
      maxSizeBytes: ATTACHMENT_MAX_BYTES_CEILING,
      retentionDays: 365,
    });
  });

  test('how many dynamic lists', async () => {
    const { t, update } = await setup();
    for (const listsMaxDynamicLists of [0, 201, 2.5]) {
      await expect(update({ listsMaxDynamicLists })).rejects.toThrow('invalid_max_dynamic_lists');
    }
    await update({ listsMaxDynamicLists: 200 });
    expect((await stored(t)).lists).toEqual({ maxDynamicLists: 200 });
    await update({ listsMaxDynamicLists: 1 });
    expect((await stored(t)).lists).toEqual({ maxDynamicLists: 1 });
  });

  test('how long records, events and the journal are kept: one changed, the others stay', async () => {
    const { t, update } = await setup({ retention: { softDeleteDays: 10, auditDays: 100 } });
    await expect(update({ retentionSoftDeleteDays: 0 })).rejects.toThrow(
      'retention_out_of_bounds:softDeleteDays',
    );
    await expect(update({ retentionEventDays: 29 })).rejects.toThrow(
      'retention_out_of_bounds:eventDays',
    );
    await expect(update({ retentionAuditDays: 3651 })).rejects.toThrow(
      'retention_out_of_bounds:auditDays',
    );
    await update({ retentionEventDays: 60 });
    expect((await stored(t)).retention).toEqual({
      softDeleteDays: 10,
      eventDays: 60,
      auditDays: 100,
    });
    // Something else: the retention is not rewritten.
    await update({ senderName: 'Autre' });
    expect((await stored(t)).retention).toEqual({
      softDeleteDays: 10,
      eventDays: 60,
      auditDays: 100,
    });
  });
});

describe('settings: e-mail and sign-in providers', () => {
  test('an SMTP relay needs a host and a port; what is not given keeps what is stored', async () => {
    const { t, update } = await setup();
    await expect(
      update({ email: { provider: 'smtp', smtpHost: 'smtp.example.com' } }),
    ).rejects.toThrow('smtp_config_incomplete');
    await expect(update({ email: { provider: 'smtp', smtpPort: 587 } })).rejects.toThrow(
      'smtp_config_incomplete',
    );
    await update({
      email: {
        provider: 'smtp',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'user',
        smtpPass: 'pass',
        brevoSmsSender: 'ACME',
      },
    });
    expect((await stored(t)).email).toEqual({
      provider: 'smtp',
      brevoApiKey: '',
      brevoWebhookSecret: '',
      brevoSmsSender: 'ACME',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'user',
      smtpPass: 'pass',
    });
    // Back to Brevo with a key: the SMTP fields and the sender stay, an empty password keeps the stored one.
    await update({
      email: { provider: 'brevo', brevoApiKey: 'key', smtpPass: '', smtpSecure: true },
    });
    expect((await stored(t)).email).toEqual({
      provider: 'brevo',
      brevoApiKey: 'key',
      brevoWebhookSecret: '',
      brevoSmsSender: 'ACME',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: true,
      smtpUser: 'user',
      smtpPass: 'pass',
    });
    expect((await lastAudit(t)).metadata).toMatchObject({ fields: [], emailProvider: 'brevo' });
  });

  test('a provider keeps its stored secret when none is given, and the audit names the providers, never a secret', async () => {
    const { t, update } = await setup();
    const sso = {
      providerId: 'acme',
      label: 'Acme',
      issuerUrl: 'https://id.acme.example',
      clientId: 'cid',
      scopes: ['openid'],
      enabled: true,
    };
    await update({
      ssoProviders: [{ ...sso, clientSecret: 'sso-secret' }],
      socialProviders: [
        { id: 'google', clientId: 'gid', clientSecret: 'google-secret', enabled: true },
      ],
    });
    await update({
      ssoProviders: [
        { ...sso, label: 'Acme SSO' },
        { ...sso, providerId: 'other', clientSecret: '' },
      ],
      socialProviders: [
        { id: 'google', clientId: 'gid2', clientSecret: '', enabled: false },
        { id: 'github', clientId: 'hid', enabled: true },
      ],
    });
    const cfg = await stored(t);
    expect(cfg.auth.ssoProviders).toEqual([
      { ...sso, label: 'Acme SSO', clientSecret: 'sso-secret' },
      { ...sso, providerId: 'other', clientSecret: '' },
    ]);
    expect(cfg.auth.socialProviders).toEqual([
      { id: 'google', clientId: 'gid2', clientSecret: 'google-secret', enabled: false },
      { id: 'github', clientId: 'hid', clientSecret: '', enabled: true },
    ]);
    const audit = await lastAudit(t);
    expect(audit.metadata).toEqual({
      fields: [],
      ssoProviderIds: ['acme', 'other'],
      socialProviderIds: ['google', 'github'],
    });
    expect(JSON.stringify(audit)).not.toContain('secret');

    // Another field: the providers stay as they are.
    await update({ magicLinkEnabled: false });
    expect((await stored(t)).auth).toEqual({
      magicLinkEnabled: false,
      ssoProviders: cfg.auth.ssoProviders,
      socialProviders: cfg.auth.socialProviders,
    });
  });
});
