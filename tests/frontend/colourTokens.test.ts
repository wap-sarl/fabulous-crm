import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
/** The showcase of the design system prints the values of the tokens it shows. */
const SHOWCASE = 'src/pages/design-system/DesignSystemPage.tsx';
/** A colour written by hand: a hex value in a class or a string, or a colour function. */
const RAW_COLOUR = /['"[]#[0-9a-fA-F]{3,8}['"\]]|\b(?:rgb|hsl)a?\(/;

function sourcesOf(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesOf(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

test('a page or a feature paints with the tokens of the theme, never with a colour written by hand', () => {
  const painted = [...sourcesOf('src/pages'), ...sourcesOf('src/features')]
    .filter((path) => path !== SHOWCASE)
    .flatMap((path) =>
      readFileSync(join(ROOT, path), 'utf8')
        .split('\n')
        .flatMap((line, i) => (RAW_COLOUR.test(line) ? [`${path}:${i + 1}`] : [])),
    );
  expect(painted).toEqual([]);
});

test('a token a class names is a token the theme defines', () => {
  const theme = readFileSync(join(ROOT, 'src/design-system/theme.css'), 'utf8');
  const root = theme.slice(theme.indexOf(':root {'), theme.indexOf('@theme inline'));
  const classes = theme.slice(theme.indexOf('@theme inline'));
  for (const token of ['violet', 'violet-soft', 'border-strong', 'ghost']) {
    expect(root).toMatch(new RegExp(`--${token}: #[0-9a-f]{6};`));
    expect(classes).toContain(`--color-${token}: var(--${token});`);
  }
});
