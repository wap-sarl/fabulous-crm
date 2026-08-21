import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  cn,
  InitialsAvatar,
  Logo,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@crm/design-system';
import { Menu, LogOut } from 'lucide-react';
import { usePublicConfig } from '../config';

export interface NavItem {
  label: string;
  icon: ReactNode;
  path: string;
  category?: string;
  position?: 'bottom';
}

interface SidebarContentProps {
  navItems: NavItem[];
  currentPath: string;
  onNavigate: (path: string) => void;
  onItemClick?: () => void;
  userName?: string;
  userEmail?: string;
  onLogout?: () => void;
}

function NavItemButton({
  item,
  currentPath,
  onNavigate,
  onItemClick,
}: {
  item: NavItem;
  currentPath: string;
  onNavigate: (path: string) => void;
  onItemClick?: () => void;
}) {
  const active = currentPath === item.path;
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          onNavigate(item.path);
          onItemClick?.();
        }}
        className={cn(
          'flex w-full cursor-pointer items-center gap-[11px] rounded-[9px] px-2.5 py-2 text-left text-sm font-semibold transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0',
          active
            ? 'bg-primary-soft text-primary-strong'
            : 'text-soft hover:bg-accent hover:text-ink',
        )}
      >
        {item.icon}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
    </li>
  );
}

function SidebarContent({
  navItems,
  currentPath,
  onNavigate,
  onItemClick,
  userName,
  userEmail,
  onLogout,
}: SidebarContentProps) {
  const topItems = navItems.filter((item) => item.position !== 'bottom');
  const bottomItems = navItems.filter((item) => item.position === 'bottom');
  const { config } = usePublicConfig();

  return (
    <div className="flex h-full flex-col px-3.5 py-[18px]">
      <div className="px-1">
        <Logo src={config?.logoUrl} label={config?.organizationName} />
      </div>

      <nav className="mt-6 flex min-h-0 flex-1 flex-col">
        <h3 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-placeholder">
          Espace de travail
        </h3>
        <ul className="space-y-0.5">
          {topItems.map((item) => (
            <NavItemButton
              key={item.path}
              item={item}
              currentPath={currentPath}
              onNavigate={onNavigate}
              onItemClick={onItemClick}
            />
          ))}
        </ul>

        <div className="mt-auto">
          {bottomItems.length > 0 && (
            <>
              <div className="my-3 h-px bg-[#EEF0F3]" />
              <ul className="space-y-0.5">
                {bottomItems.map((item) => (
                  <NavItemButton
                    key={item.path}
                    item={item}
                    currentPath={currentPath}
                    onNavigate={onNavigate}
                    onItemClick={onItemClick}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </nav>

      {userName && (
        <div className="mt-4 flex items-center gap-2.5 rounded-[11px] bg-[#F7F8FA] px-2.5 py-2.5">
          <InitialsAvatar name={userName} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">{userName}</div>
            {userEmail && <div className="truncate text-[11.5px] text-faint">{userEmail}</div>}
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              aria-label="Déconnexion"
              title="Déconnexion"
              className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors hover:bg-[#EEF0F3] hover:text-destructive"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface DashboardLayoutProps {
  children: ReactNode;
  navItems: NavItem[];
  onNavigate: (path: string) => void;
  currentPath: string;
  userName?: string;
  userAvatar?: string;
  userEmail?: string;
  onLogout?: () => void;
}

export function DashboardLayout({
  children,
  navItems,
  onNavigate,
  currentPath,
  userName,
  userEmail,
  onLogout,
}: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { config } = usePublicConfig();

  // Swipe-to-dismiss for mobile sheet
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef({ x: 0, y: 0 });
  const touchDelta = useRef(0);
  const isSwiping = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchDelta.current = 0;
    isSwiping.current = false;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStart.current.x;
    const dy = e.touches[0].clientY - touchStart.current.y;

    if (!isSwiping.current && Math.abs(dx) > 10) {
      isSwiping.current = Math.abs(dx) > Math.abs(dy);
    }

    if (!isSwiping.current) return;

    touchDelta.current = Math.max(0, dx);
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateX(${touchDelta.current}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const shouldClose = touchDelta.current > 80;
    if (sheetRef.current) {
      sheetRef.current.style.transition = '';
      sheetRef.current.style.transform = '';
    }
    if (shouldClose) {
      setMobileOpen(false);
    }
    touchDelta.current = 0;
    isSwiping.current = false;
  }, []);

  // Expose layout dimensions as CSS variables for positioned components
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', '236px');
    return () => {
      document.documentElement.style.removeProperty('--sidebar-width');
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden w-[236px] shrink-0 border-r border-[#EAECF0] bg-card lg:block">
        <SidebarContent
          navItems={navItems}
          currentPath={currentPath}
          onNavigate={onNavigate}
          userName={userName}
          userEmail={userEmail}
          onLogout={onLogout}
        />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="right"
          className="w-[260px] p-0"
          ref={sheetRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent
            navItems={navItems}
            currentPath={currentPath}
            onNavigate={onNavigate}
            onItemClick={() => setMobileOpen(false)}
            userName={userName}
            userEmail={userEmail}
            onLogout={onLogout}
          />
        </SheetContent>

        {/* Main column */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Slim mobile topbar — the only Sheet trigger */}
          <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 lg:hidden">
            <Logo src={config?.logoUrl} label={config?.organizationName} />
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Ouvrir la navigation"
                className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-soft hover:bg-accent"
              >
                <Menu className="size-5" />
              </button>
            </SheetTrigger>
          </header>

          {/* Page content — pages own their headers */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
            {children}
          </main>
        </div>
      </Sheet>
    </div>
  );
}
