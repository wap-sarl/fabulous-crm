import { beforeEach, describe, expect, test } from 'bun:test';
import { api, internal } from '../../convex/_generated/api';
import { PLUGINS, pluginKeySchema } from '../../convex/_lib/validators/plugins';
import { pluginsWithData } from '../../convex/lib/plugins/installed';
import {
  asIdentity,
  createTestConvex,
  pinClock,
  seedConfig,
  seedEmployee,
  type T,
} from './helpers';

const NOW = Date.UTC(2026, 9, 19, 10, 0, 0);
const SITE = 'https://crm-123.convex.site';

beforeEach(() => {
  pinClock(NOW);
  process.env.BETTER_AUTH_SECRET = 'test-auth-secret';
  process.env.CONVEX_SITE_URL = SITE;
});

/** `plugins` as the row holds it: a list, or undefined for a row from before the catalogue. */
async function setup(plugins: string[] | undefined) {
  const t = createTestConvex();
  const admin = await seedEmployee(t, { email: 'admin@example.com', role: 'admin' });
  const member = await seedEmployee(t, { email: 'member@example.com', role: 'member' });
  await seedConfig(t, { plugins });
  return { t, admin: asIdentity(t, admin.identity), member: asIdentity(t, member.identity) };
}

// `t.run` hands an absent field back as null: name it, so a test can tell it from a list.
const installed = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query('appConfig').first())?.plugins ?? 'absent');

const pluginAudits = (t: T) =>
  t.run((ctx) =>
    ctx.db
      .query('auditLogs')
      .filter((q) => q.eq(q.field('entityType'), 'plugin'))
      .collect(),
  );

const createPage = (as: ReturnType<typeof asIdentity>, slug = 'demo') =>
  as.mutation(api.features.landingPages.mutations.createLandingPage, {
    name: 'Démo',
    slug,
    seo: { title: 'Démo', description: 'Une démo.' },
    sections: [{ id: 'hero', type: 'hero', heading: 'Bonjour', text: 'Un mot.' }],
  });

const publicPlugins = async (t: T) =>
  ((await t.query(api.features.config.queries.getPublicConfig, {})) as { plugins: string[] })
    .plugins;

describe('the catalogue', () => {
  test('lists hosted pages as the first plugin, and only keys of the catalogue pass', () => {
    expect(PLUGINS.map((plugin) => plugin.key)).toEqual(['landing-pages']);
    expect(pluginKeySchema.safeParse('landing-pages').success).toBe(true);
    expect(pluginKeySchema.safeParse('quotes').success).toBe(false);
    expect(new Set(PLUGINS.map((plugin) => plugin.name)).size).toBe(PLUGINS.length);
  });

  test('is shown to the settings right with each plugin’s state and the public addresses an uninstall closes, and refused to the others', async () => {
    const { admin, member } = await setup(['landing-pages']);
    expect(await admin.query(api.features.plugins.queries.listPlugins, {})).toEqual([
      {
        key: 'landing-pages',
        name: 'Pages',
        description: PLUGINS[0].description,
        installed: true,
        publicUrls: [],
        morePublicUrls: false,
      },
    ]);
    const live = await createPage(admin, 'live');
    await admin.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
      pageId: live,
      status: 'published',
    });
    // A draft and a deleted page close no address.
    await createPage(admin, 'draft');
    const gone = await createPage(admin, 'gone');
    await admin.mutation(api.features.landingPages.mutations.deleteLandingPage, { pageId: gone });
    expect((await admin.query(api.features.plugins.queries.listPlugins, {}))[0]).toMatchObject({
      publicUrls: [`${SITE}/p/live`],
      morePublicUrls: false,
    });
    await expect(member.query(api.features.plugins.queries.listPlugins, {})).rejects.toThrow(
      'Unauthorized',
    );
  });
});

describe('installing a plugin', () => {
  test('a fresh deployment has none; the settings right installs one, audited, and the public config says so', async () => {
    const { t, admin } = await setup([]);
    expect(await publicPlugins(t)).toEqual([]);
    expect(
      await admin.mutation(api.features.plugins.mutations.installPlugin, { key: 'landing-pages' }),
    ).toEqual({ installed: ['landing-pages'] });
    expect(await installed(t)).toEqual(['landing-pages']);
    expect(await publicPlugins(t)).toEqual(['landing-pages']);
    const audits = await pluginAudits(t);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityId: 'landing-pages',
      action: 'update',
      metadata: { installed: true },
    });
  });

  test('installing twice changes nothing and writes no second audit row', async () => {
    const { t, admin } = await setup(['landing-pages']);
    expect(
      await admin.mutation(api.features.plugins.mutations.installPlugin, { key: 'landing-pages' }),
    ).toEqual({ installed: ['landing-pages'] });
    expect(await pluginAudits(t)).toHaveLength(0);
  });

  test('a key outside the catalogue is refused, and so is a person without the settings right', async () => {
    const { admin, member } = await setup([]);
    await expect(
      admin.mutation(api.features.plugins.mutations.installPlugin, { key: 'quotes' }),
    ).rejects.toMatchObject({ data: { code: 'plugin_unknown', reason: 'quotes' } });
    await expect(
      member.mutation(api.features.plugins.mutations.installPlugin, { key: 'landing-pages' }),
    ).rejects.toThrow('Unauthorized');
  });

  test('a key the catalogue no longer knows is kept in the row and ignored everywhere', async () => {
    const { t, admin } = await setup(['retired', 'landing-pages']);
    expect(await publicPlugins(t)).toEqual(['landing-pages']);
    await admin.mutation(api.features.plugins.mutations.uninstallPlugin, { key: 'landing-pages' });
    expect(await installed(t)).toEqual([]);
  });
});

describe('an uninstalled plugin', () => {
  test('refuses its functions with plugin_not_installed, and its public route answers 404; the data is back after a reinstall', async () => {
    const { t, admin } = await setup(['landing-pages']);
    const pageId = await createPage(admin);
    await admin.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
      pageId,
      status: 'published',
    });
    expect((await t.fetch('/p/demo', { method: 'GET' })).status).toBe(200);

    await admin.mutation(api.features.plugins.mutations.uninstallPlugin, { key: 'landing-pages' });
    expect(await publicPlugins(t)).toEqual([]);
    await expect(
      admin.query(api.features.landingPages.queries.listLandingPages, {}),
    ).rejects.toMatchObject({
      data: { code: 'plugin_not_installed', plugin: 'landing-pages' },
    });
    await expect(createPage(admin, 'autre')).rejects.toMatchObject({
      data: { code: 'plugin_not_installed' },
    });
    expect((await t.fetch('/p/demo', { method: 'GET' })).status).toBe(404);
    // The embed's page lookup finds nothing either: a submission attributes to no page.
    expect(
      await t.query(internal.features.landingPages.internal.getPageSlug, { page: pageId }),
    ).toBeNull();
    const kept = await t.run((ctx) => ctx.db.get(pageId));
    expect(kept?.status).toBe('published');

    await admin.mutation(api.features.plugins.mutations.installPlugin, { key: 'landing-pages' });
    expect((await t.fetch('/p/demo', { method: 'GET' })).status).toBe(200);
    const pages = await admin.query(api.features.landingPages.queries.listLandingPages, {});
    expect(pages.map((page) => page._id)).toEqual([pageId]);
  });
});

describe('a deployment from before the catalogue', () => {
  /** The row as the upgrade finds it: no `plugins` field. */
  const forget = (t: T) =>
    t.run(async (ctx) => {
      const cfg = (await ctx.db.query('appConfig').first())!;
      await ctx.db.patch(cfg._id, { plugins: undefined });
    });

  test('keeps serving its published pages, lists the plugin as installed, and the migration only writes that down', async () => {
    const { t, admin } = await setup(['landing-pages']);
    const pageId = await createPage(admin);
    await admin.mutation(api.features.landingPages.mutations.setLandingPageStatus, {
      pageId,
      status: 'published',
    });
    await forget(t);
    expect(await installed(t)).toBe('absent');
    expect(await publicPlugins(t)).toEqual(['landing-pages']);
    expect((await t.fetch('/p/demo', { method: 'GET' })).status).toBe(200);
    expect(await admin.query(api.features.landingPages.queries.listLandingPages, {})).toHaveLength(
      1,
    );
    expect(await admin.query(api.features.plugins.queries.listPlugins, {})).toMatchObject([
      { key: 'landing-pages', installed: true },
    ]);

    await t.mutation(internal.migrations.addPluginsInUse, {});
    expect(await installed(t)).toEqual(['landing-pages']);
    expect((await t.fetch('/p/demo', { method: 'GET' })).status).toBe(200);
  });

  test('uninstalling from that state writes the list without the plugin', async () => {
    const { t, admin } = await setup(['landing-pages']);
    await createPage(admin);
    await forget(t);
    await admin.mutation(api.features.plugins.mutations.uninstallPlugin, { key: 'landing-pages' });
    expect(await installed(t)).toEqual([]);
    expect(await publicPlugins(t)).toEqual([]);
  });

  test('with no page, or deleted pages only, has nothing installed, and the migration writes an empty list', async () => {
    const { t, admin } = await setup(['landing-pages']);
    expect(await t.run((ctx) => pluginsWithData(ctx))).toEqual([]);
    const pageId = await createPage(admin);
    expect(await t.run((ctx) => pluginsWithData(ctx))).toEqual(['landing-pages']);
    await admin.mutation(api.features.landingPages.mutations.deleteLandingPage, { pageId });
    expect(await t.run((ctx) => pluginsWithData(ctx))).toEqual([]);
    await forget(t);
    expect(await publicPlugins(t)).toEqual([]);
    await expect(
      admin.query(api.features.landingPages.queries.listLandingPages, {}),
    ).rejects.toMatchObject({ data: { code: 'plugin_not_installed' } });

    await t.mutation(internal.migrations.addPluginsInUse, {});
    expect(await installed(t)).toEqual([]);
  });

  test('a list once written is the whole truth: pages do not reinstall a plugin taken out', async () => {
    const { t, admin } = await setup(['landing-pages']);
    await createPage(admin);
    await admin.mutation(api.features.plugins.mutations.uninstallPlugin, { key: 'landing-pages' });
    await t.mutation(internal.migrations.addPluginsInUse, {});
    expect(await installed(t)).toEqual([]);
    expect(await publicPlugins(t)).toEqual([]);
  });
});
