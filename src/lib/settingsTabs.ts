/** What decides where an entry goes and who sees it; the sidebar and the settings page read the same entries. */
export interface PlacedEntry {
  path: string;
  requires?: 'settings';
  group?: string;
}

export interface TabGroup<Entry> {
  name: string;
  tabs: Entry[];
}

export const SETTINGS_ROOT = '/settings';

/** The group of an overlay's settings entries that name none. */
export const OVERLAY_GROUP = 'Autres';

export const isSettingsPath = (path: string): boolean => path.startsWith(`${SETTINGS_ROOT}/`);

/** An entry that asks for the settings right is hidden from a role that does not have it. */
const maySee = (entry: PlacedEntry, hasSettings: boolean): boolean =>
  entry.requires !== 'settings' || hasSettings;

/** The tabs a person sees: the groups of the core, then the overlay's settings entries in the groups they name, in the order they first name them; an entry naming a group of the core joins it, after the core's tabs. A group left empty is dropped. */
export function visibleTabGroups<Entry extends PlacedEntry>(
  groups: TabGroup<Entry>[],
  overlayEntries: Entry[],
  hasSettings: boolean,
): TabGroup<Entry>[] {
  const all: TabGroup<Entry>[] = groups.map((group) => ({ ...group, tabs: [...group.tabs] }));
  for (const entry of overlayEntries.filter((e) => isSettingsPath(e.path))) {
    const name = entry.group ?? OVERLAY_GROUP;
    let group = all.find((g) => g.name === name);
    if (!group) {
      group = { name, tabs: [] };
      all.push(group);
    }
    group.tabs.push(entry);
  }
  return all
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => maySee(tab, hasSettings)) }))
    .filter((group) => group.tabs.length > 0);
}

/** The entries of an overlay that stay in the sidebar: those that are not settings. */
export const sidebarEntries = <Entry extends PlacedEntry>(overlayEntries: Entry[]): Entry[] =>
  overlayEntries.filter((entry) => !isSettingsPath(entry.path));

/** The tab an address belongs to: the one whose path it is, or starts with. */
export function activeTabPath(pathname: string, tabs: PlacedEntry[]): string | undefined {
  return tabs
    .map((tab) => tab.path)
    .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
}
