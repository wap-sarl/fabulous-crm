/** The derived shades mirror how theme.css defines them for its default color; `--primary-foreground` is left untouched on purpose, always white. */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The vars we override, so reset can remove exactly this set. */
const MANAGED_VARS = ['--primary', '--primary-strong', '--primary-soft', '--ring'] as const;

/** The last accent applied, read synchronously at startup so the first paint does not flash the theme default. */
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
function derivePrimaryShades(hex: string): { strong: string; soft: string } {
  const { h, s, l } = hexToHsl(hex);
  return {
    // Saturation is trimmed along with lightness: a lightness-only drop causes a chroma spike near L=50%.
    strong: hslToHex({ h, s: clamp(s * 0.85, 0, 100), l: clamp(l - 7, 0, 100) }),
    // Near-white tint for soft backgrounds and focus rings.
    soft: hslToHex({ h, s, l: 96 }),
  };
}

/** Does nothing on a malformed value, so a bad stored config can never break rendering. */
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
    // Storage may be unavailable: the flash prevention is a progressive enhancement, so it is skipped.
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

/** Runs synchronously before React renders, from the cached accent; `BrandingHead` later reconciles it with the live config. */
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
