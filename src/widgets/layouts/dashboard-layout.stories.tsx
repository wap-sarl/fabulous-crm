import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Settings, Users } from 'lucide-react';
import { StaticPublicConfigProvider } from '../config/ConfigContext';
import { DashboardLayout, type NavItem } from './DashboardLayout';

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

/** The shell as `DashboardShell` composes it: a column of the viewport's height, the guard's banner above when there is one, the layout filling the rest. */
function Shell({ banner, rows }: { banner: boolean; rows: number }) {
  return (
    <StaticPublicConfigProvider config={CONFIG}>
      <div className="flex h-dvh flex-col">
        {banner && (
          <div
            data-testid="banner"
            className="flex flex-wrap items-center justify-between gap-x-4 bg-primary-soft px-4 py-2 text-sm text-ink"
          >
            <span>Mode test : 1 / 3 sièges.</span>
            <a href="/settings/subscription" className="font-medium underline">
              Passer en illimité
            </a>
          </div>
        )}
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
        </DashboardLayout>
      </div>
    </StaticPublicConfigProvider>
  );
}

const meta = {
  title: 'Layout/DashboardLayout',
  component: Shell,
  args: { banner: false, rows: 6 },
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

/** A guard's banner above the shell: the shell takes what is left, so the sidebar's bottom entries and the user block stay in view. */
export const UnderABanner: Story = {
  name: 'Under a banner',
  args: { banner: true, rows: 40 },
  play: async ({ canvasElement }) => {
    await fits(canvasElement);
    const banner = canvasElement.querySelector('[data-testid="banner"]')!.getBoundingClientRect();
    const aside = canvasElement.querySelector('aside')!.getBoundingClientRect();
    await expect(Math.round(aside.top)).toBe(Math.round(banner.bottom));
    const main = canvasElement.querySelector('main')!;
    await expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
  },
};
