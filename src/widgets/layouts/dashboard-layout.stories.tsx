import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { expect } from 'storybook/test';
import { Settings, Users } from 'lucide-react';
import { StaticPublicConfigProvider } from '../config/ConfigContext';
import { DashboardLayout, type NavItem } from './DashboardLayout';
import { ShellFrame } from './ShellFrame';

const CONFIG = {
  setupComplete: true,
  organizationName: 'Clinique Nord',
  timezone: 'Europe/Paris',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  plugins: [],
  authCallbackBaseUrl: null,
  auth: { magicLink: true, socialProviders: [], customSsoProviders: [] },
};

const NAV_ITEMS: NavItem[] = [
  { label: 'Leads', icon: <Users />, path: '/leads' },
  { label: 'Paramètres', icon: <Settings />, path: '/settings', position: 'bottom' },
];

type Guard = 'none' | 'fragment' | 'wrapper';

/** A guard's banner, as the SaaS overlay shows one in free mode. */
const Banner = () => (
  <div
    data-testid="banner"
    className="flex flex-wrap items-center justify-between gap-x-4 bg-primary-soft px-4 py-2 text-sm text-ink"
  >
    <span>Mode test : 1 / 3 sièges.</span>
    <a href="/settings/subscription" className="font-medium underline">
      Passer en illimité
    </a>
  </div>
);

/** The two forms the contract allows: banner and children side by side, or inside a wrapper that is itself the flex column. */
const GUARDS: Record<Guard, (children: ReactNode) => ReactNode> = {
  none: (children) => children,
  fragment: (children) => (
    <>
      <Banner />
      {children}
    </>
  ),
  wrapper: (children) => (
    <div className="flex min-h-0 flex-1 flex-col">
      <Banner />
      {children}
    </div>
  ),
};

/** The shell as `DashboardShell` composes it: the frame, the guard's output, the layout filling the rest. */
function Shell({ guard, rows }: { guard: Guard; rows: number }) {
  return (
    <StaticPublicConfigProvider config={CONFIG}>
      <ShellFrame>
        {GUARDS[guard](
          <DashboardLayout
            navItems={NAV_ITEMS}
            currentPath="/leads"
            onNavigate={() => undefined}
            userName="Camille Roux"
            userEmail="camille.roux@example.com"
            onLogout={() => undefined}
          >
            <div className="space-y-3 p-7">
              {Array.from({ length: rows }, (_, i) => (
                <div key={String(i)} className="h-10 rounded-lg bg-secondary" />
              ))}
            </div>
          </DashboardLayout>,
        )}
      </ShellFrame>
    </StaticPublicConfigProvider>
  );
}

const meta = {
  title: 'Layout/DashboardLayout',
  component: Shell,
  args: { guard: 'none', rows: 6 },
  argTypes: { guard: { control: 'radio', options: ['none', 'fragment', 'wrapper'] } },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The document never scrolls: the shell takes the viewport, a long page scrolls inside its main column, the user block stays in view. */
const fits = async (canvasElement: HTMLElement) => {
  const doc = canvasElement.ownerDocument;
  const viewport = doc.documentElement.clientHeight;
  await expect(doc.documentElement.scrollHeight).toBeLessThanOrEqual(viewport);
  const logout = canvasElement.querySelector('[aria-label="Déconnexion"]')!;
  await expect(Math.round(logout.getBoundingClientRect().bottom)).toBeLessThanOrEqual(viewport);
  const main = canvasElement.querySelector('main')!;
  await expect(Math.round(main.getBoundingClientRect().bottom)).toBeLessThanOrEqual(viewport);
};

export const Alone: Story = {
  play: ({ canvasElement }) => fits(canvasElement),
};

/** A long page under a guard's banner: the banner ends where the sidebar starts, the page scrolls inside its main column, the user block stays in view. */
const underABanner = async (canvasElement: HTMLElement) => {
  await fits(canvasElement);
  const banner = canvasElement.querySelector('[data-testid="banner"]')!.getBoundingClientRect();
  const aside = canvasElement.querySelector('aside')!.getBoundingClientRect();
  await expect(Math.round(aside.top)).toBe(Math.round(banner.bottom));
  const main = canvasElement.querySelector('main')!;
  await expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
};

/** A guard rendering its banner and the shell side by side, as the SaaS overlay does. */
export const UnderABanner: Story = {
  name: 'Under a banner',
  args: { guard: 'fragment', rows: 40 },
  play: ({ canvasElement }) => underABanner(canvasElement),
};

/** A guard wrapping its banner and the shell in an element of its own: the wrapper must be the flex column itself. */
export const UnderAWrappingGuard: Story = {
  name: 'Under a wrapping guard',
  args: { guard: 'wrapper', rows: 40 },
  play: ({ canvasElement }) => underABanner(canvasElement),
};
