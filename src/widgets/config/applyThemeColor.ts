/**
 * Runtime application of the admin-chosen brand accent color. Overrides the
 * `--primary` family of CSS custom properties on `document.documentElement`,
 * exactly the mechanism used for `--sidebar-width` in DashboardLayout. The
 * derived shades mirror how theme.css defines them for the default `#5b50f5`
 * (strong = a touch darker, soft = a near-white tint), so gradients, soft
 * backgrounds and focus rings stay coherent with a custom color.
 *
 * `--primary-foreground` is intentionally left untouched (always white).
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The vars we override, so reset can remove exactly this set. */
const MANAGED_VARS = ['--primary', '--primary-strong', '--primary-soft', '--ring'] as const;

/**
 * localStorage key for the last-applied accent. Read synchronously at startup
 * (see bootstrapPrimaryColor) so the first paint already uses the brand color
 * instead of flashing the theme.css default before the Convex config resolves.
 */
const ACCENT_STORAGE_KEY = 'crm.accent';

type Hsl = { h: number; s: number; l: number };

function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Compute the derived `--primary-strong` / `--primary-soft` from a base hex. */
export function derivePrimaryShades(hex: string): { strong: string; soft: string } {
  const { h, s, l } = hexToHsl(hex);
  return {
    // Darker + slightly muted for the button gradient end + hover states.
    // Trimming saturation alongside lightness avoids the chroma spike that a
    // lightness-only drop causes near L=50% (keeps `#5b50f5` → ~`#4b41e0`).
    strong: hslToHex({ h, s: clamp(s * 0.85, 0, 100), l: clamp(l - 7, 0, 100) }),
    // Near-white tint for soft backgrounds and focus rings.
    soft: hslToHex({ h, s, l: 96 }),
  };
}

/**
 * Apply a `#rrggbb` brand color app-wide. No-op on a malformed value so a bad
 * stored config can never break rendering. Callable repeatedly for live preview.
 */
export function applyPrimaryColor(hex: string): void {
  if (typeof document === 'undefined' || !HEX_RE.test(hex)) return;
  const root = document.documentElement.style;
  const { strong, soft } = derivePrimaryShades(hex);
  root.setProperty('--primary', hex);
  root.setProperty('--ring', hex);
  root.setProperty('--primary-strong', strong);
  root.setProperty('--primary-soft', soft);
  // Remember it so the next load can paint the brand color before React mounts.
  try {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, hex);
  } catch {
    // Storage unavailable (private mode / disabled) — flash prevention is a
    // progressive enhancement, so silently skip.
  }
}

/** Remove the overrides so the theme.css defaults take over again. */
export function resetPrimaryColor(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const name of MANAGED_VARS) root.removeProperty(name);
  // Drop the cache too, so a cleared config doesn't re-flash a stale accent.
  try {
    window.localStorage.removeItem(ACCENT_STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing cached to remove.
  }
}

/**
 * Apply the last-known accent color synchronously, before React renders. Call
 * once at app entry (see main.tsx) so the first spinner/paint uses the brand
 * color instead of the theme.css default `#5b50f5`. `BrandingHead` later
 * reconciles to the live Convex config value. No-op on first-ever visit.
 */
export function bootstrapPrimaryColor(): void {
  if (typeof window === 'undefined') return;
  let cached: string | null = null;
  try {
    cached = window.localStorage.getItem(ACCENT_STORAGE_KEY);
  } catch {
    return;
  }
  if (cached && HEX_RE.test(cached)) applyPrimaryColor(cached);
}
