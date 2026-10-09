import { Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { cn, Spinner } from '@crm/design-system';
import { useAuth } from '@crm/widgets';
import { frontendExtensions } from '../lib/frontendExtensions';
import { SETTINGS_GROUPS } from '../lib/navigation';
import { activeTabPath, SETTINGS_ROOT, visibleTabGroups } from '../lib/settingsTabs';

/** The settings page: the tabs the role may see on the left, the tab's own page on the right. */
export function SettingsLayout() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const hasSettings = !!user?.access.settings;

  // The extensions are fixed for the life of the app: a test that switches them while this is mounted sees stale tabs, and that is fine.
  const groups = useMemo(
    () => visibleTabGroups(SETTINGS_GROUPS, frontendExtensions().navItems, hasSettings),
    [hasSettings],
  );
  const tabs = useMemo(() => groups.flatMap((group) => group.tabs), [groups]);
  const active = activeTabPath(pathname, tabs);

  // The marker sits behind the chosen tab and slides to the next one: its place is read from the tab itself.
  const list = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  useLayoutEffect(() => {
    const tabList = list.current;
    if (!tabList) return;
    const place = () => {
      const tab = active
        ? tabList.querySelector<HTMLElement>(`[data-tab="${CSS.escape(active)}"]`)
        : null;
      setMarker(
        tab && {
          top: tab.offsetTop,
          left: tab.offsetLeft,
          width: tab.offsetWidth,
          height: tab.offsetHeight,
        },
      );
      return tab;
    };
    const tab = place();
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // The tabs are a column on a wide screen and a row on a narrow one, and a label widens when its font arrives: the marker follows the list and the tab.
    const observer = new ResizeObserver(place);
    observer.observe(tabList);
    if (tab) observer.observe(tab);
    document.fonts?.ready.then(place);
    return () => observer.disconnect();
  }, [active]);

  if (!user) return null;
  // `/settings` itself is the first tab the person may see.
  if (pathname === SETTINGS_ROOT || pathname === `${SETTINGS_ROOT}/`) {
    return tabs[0] ? <Navigate to={tabs[0].path} replace /> : null;
  }

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <nav
        aria-label="Paramètres"
        className="shrink-0 border-b border-border bg-card lg:sticky lg:top-0 lg:h-screen lg:w-[248px] lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r"
      >
        {/* Not a heading: each tab's page has the one h1. */}
        <p className="px-6 pt-6 pb-2 text-lg font-bold text-ink lg:pt-8">Paramètres</p>
        <div
          ref={list}
          className="relative flex gap-1 overflow-x-auto px-4 pb-3 lg:flex-col lg:gap-0 lg:overflow-visible lg:pb-8"
        >
          {marker && (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-[9px] bg-primary-soft transition-[transform,width,height] duration-200 ease-out motion-reduce:transition-none"
              style={{
                top: 0,
                left: 0,
                width: marker.width,
                height: marker.height,
                transform: `translate(${marker.left}px, ${marker.top}px)`,
              }}
            />
          )}
          {groups.map((group) => (
            <div key={group.name} className="flex shrink-0 gap-1 lg:flex-col lg:gap-0">
              <div className="hidden px-2.5 pt-5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint lg:block">
                {group.name}
              </div>
              {group.tabs.map((tab) => (
                <Link
                  key={tab.path}
                  to={tab.path}
                  data-tab={tab.path}
                  aria-current={tab.path === active ? 'page' : undefined}
                  className={cn(
                    'relative flex shrink-0 cursor-pointer items-center gap-[11px] whitespace-nowrap rounded-[9px] px-2.5 py-2 text-left text-sm font-semibold transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0',
                    tab.path === active ? 'text-primary-strong' : 'text-soft hover:text-ink',
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="min-w-0 flex-1">
        <Suspense
          fallback={
            <div className="flex justify-center py-24">
              <Spinner size="lg" />
            </div>
          }
        >
          {/* A new tab fades in; the key makes it a new element, so the animation plays at each change. */}
          <div
            key={active ?? pathname}
            className="animate-in fade-in slide-in-from-bottom-1 duration-200 motion-reduce:animate-none"
          >
            <Outlet />
          </div>
        </Suspense>
      </div>
    </div>
  );
}
