/** The e-mails' palette, the one of theme.css: an e-mail cannot load the app's stylesheet, so the values are repeated here. Free of `'use node'`: the templates and their previews import it. */
export const EMAIL_PALETTE = {
  canvas: '#f6f7f9',
  card: '#ffffff',
  border: '#eaecf0',
  ink: '#14161c',
  body: '#3a3f4a',
  soft: '#5b6270',
  faint: '#98a0ad',
  primary: '#5b50f5',
} as const;

/** Mail clients load no web font: the system stack, as the app falls back to it. */
export const EMAIL_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The configured accent when it is a `#rrggbb`, the theme's default otherwise. */
export function accentOf(primaryColor: string | null | undefined): string {
  return primaryColor && HEX_COLOR.test(primaryColor)
    ? primaryColor.toLowerCase()
    : EMAIL_PALETTE.primary;
}

/** WCAG relative luminance of a `#rrggbb`. */
function luminanceOf(hex: string): number {
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two `#rrggbb`. */
export function contrastOf(a: string, b: string): number {
  const [light, dark] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The text colour that reads best on an accent: white on a dark one, black on a light one. Black, not ink: with it the worse of the two is 4.58:1 on the worst accent, 4.25:1 with ink. */
export function readableOn(background: string): string {
  return contrastOf(background, '#ffffff') >= contrastOf(background, '#000000')
    ? '#ffffff'
    : '#000000';
}
