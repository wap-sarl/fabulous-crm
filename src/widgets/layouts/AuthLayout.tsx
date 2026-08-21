import type { ReactNode } from 'react';
import { Logo } from '@crm/design-system';
import { usePublicConfig } from '../config';

type ColorScheme = 'primary' | 'secondary';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Kept for API compatibility — ignored by the Cadence split layout. */
  brandingPosition?: 'left' | 'right';
  /** Kept for API compatibility — ignored by the Cadence split layout. */
  colorScheme?: ColorScheme;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  const { config } = usePublicConfig();
  return (
    <div className="flex min-h-screen w-full overflow-x-hidden bg-card">
      {/* Form column */}
      <div className="flex min-h-screen w-full flex-col p-[34px] lg:w-1/2 lg:p-10">
        <header className="shrink-0">
          <Logo
            role="img"
            aria-label={config?.organizationName ?? 'CRM'}
            src={config?.logoUrl}
            label={config?.organizationName}
          />
        </header>

        <main className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-10">
          <h1 className="text-[28px] font-bold tracking-[-0.025em] text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[14.5px] text-faint">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </main>

        <footer className="shrink-0 font-mono text-[11.5px] text-[#B4B9C2]">
          © 2026 CRM · RGPD
        </footer>
      </div>

      {/* Brand panel — desktop only */}
      <div
        className="relative hidden flex-1 overflow-hidden p-14 text-white lg:flex"
        style={{
          background:
            'linear-gradient(155deg, var(--primary), var(--primary-strong) 55%, color-mix(in oklab, var(--primary-strong), #000 32%))',
        }}
        aria-hidden="true"
      >
        {/* Grid overlay, faded by a radial mask */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)',
            backgroundSize: '42px 42px',
            maskImage: 'radial-gradient(circle at 30% 30%, black, transparent 70%)',
            WebkitMaskImage: 'radial-gradient(circle at 30% 30%, black, transparent 70%)',
          }}
        />
        {/* Blurred radial blob */}
        <div className="absolute -right-20 -top-20 size-80 rounded-full bg-white/20 blur-3xl" />

        <div className="relative z-10 flex max-w-[460px] flex-col justify-center gap-6">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
            CRM
          </p>
          <h2 className="text-[34px] font-bold leading-tight">
            Tous vos leads, tous vos messages, toutes vos campagnes — au même endroit.
          </h2>
          <p className="text-[15px] text-white/80">
            Suivez l'activité, lancez des campagnes e-mail et suivez les conversions en temps réel.
          </p>
          <svg width="300" height="46" viewBox="0 0 300 46" fill="none" className="mt-2 opacity-90">
            <polyline
              points="0,40 28,34 56,37 84,27 112,30 140,19 168,23 196,13 224,17 252,8 280,11 300,4"
              stroke="white"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
