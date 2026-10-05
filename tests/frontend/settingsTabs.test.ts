import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAV_ITEMS, SETTINGS_GROUPS } from '../../src/lib/navigation';
import {
  activeTabPath,
  OVERLAY_GROUP,
  sidebarEntries,
  visibleTabGroups,
} from '../../src/lib/settingsTabs';

const paths = (groups: { name: string; tabs: { path: string }[] }[]) =>
  groups.map((group) => [group.name, group.tabs.map((tab) => tab.path)]);

const billing = { label: 'Abonnement', icon: null, path: '/settings/billing' };
const webhooks = {
  label: 'Webhooks',
  icon: null,
  path: '/settings/webhooks',
  requires: 'settings' as const,
};
const reports = { label: 'Rapports', icon: null, path: '/reports' };

describe('the settings page', () => {
  test('the sidebar holds the work areas, the import and one entry for every setting', () => {
    expect(NAV_ITEMS.map((item) => item.path).filter((path) => path !== '/design-system')).toEqual([
      '/leads',
      '/companies',
      '/deals',
      '/tasks',
      '/campaigns',
      '/workflows',
      '/import',
      '/settings',
    ]);
  });

  test('a person with the settings right sees every tab, in its group and in order', () => {
    expect(paths(visibleTabGroups(SETTINGS_GROUPS, [], true))).toEqual([
      ['Organisation', ['/settings/branding', '/settings/team', '/settings/roles']],
      [
        'Données',
        [
          '/settings/properties',
          '/settings/lifecycle',
          '/settings/pipelines',
          '/settings/scoring',
          '/settings/lists',
        ],
      ],
      ['Canaux', ['/settings/email', '/settings/forms', '/settings/tracking']],
      [
        'Connexions et conformité',
        ['/settings/integrations', '/settings/api', '/settings/files', '/settings/retention'],
      ],
    ]);
  });

  test('without the settings right, the two tabs every employee has; a group left empty is not shown', () => {
    expect(paths(visibleTabGroups(SETTINGS_GROUPS, [], false))).toEqual([
      ['Données', ['/settings/lists']],
      ['Connexions et conformité', ['/settings/integrations']],
    ]);
  });

  test('every settings route is a tab, and every tab a route', () => {
    const app = readFileSync(join(import.meta.dir, '../../src/app.tsx'), 'utf8');
    const routes = [...app.matchAll(/<Route path="(\/settings\/[^"]+)"/g)].map((m) => m[1]);
    const tabs = SETTINGS_GROUPS.flatMap((group) => group.tabs.map((tab) => tab.path));
    expect(routes.sort()).toEqual([...tabs].sort());
    expect(new Set(tabs).size).toBe(tabs.length);
  });

  test('an overlay’s settings entries are tabs of their own group, under the same right; its others stay in the sidebar', () => {
    const overlay = [billing, webhooks, reports];
    expect(paths(visibleTabGroups(SETTINGS_GROUPS, overlay, true)).at(-1)).toEqual([
      OVERLAY_GROUP,
      ['/settings/billing', '/settings/webhooks'],
    ]);
    expect(paths(visibleTabGroups(SETTINGS_GROUPS, overlay, false)).at(-1)).toEqual([
      OVERLAY_GROUP,
      ['/settings/billing'],
    ]);
    expect(sidebarEntries(overlay)).toEqual([reports]);
    // `/settings` alone is the page, not a tab of it.
    expect(sidebarEntries([{ ...reports, path: '/settings' }])).toHaveLength(1);
  });

  test('the tab of an address is the one it is, or is under: the longest that fits', () => {
    const tabs = [
      { path: '/settings/forms' },
      { path: '/settings/forms/embed' },
      { path: '/settings/api' },
    ];
    expect(activeTabPath('/settings/forms', tabs)).toBe('/settings/forms');
    expect(activeTabPath('/settings/forms/embed/code', tabs)).toBe('/settings/forms/embed');
    expect(activeTabPath('/settings/forms-old', tabs)).toBeUndefined();
    expect(activeTabPath('/settings', tabs)).toBeUndefined();
  });
});
