import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader } from '../../src/design-system/components/layout/page-header';
import { SegmentedControl } from '../../src/design-system/components/navigation/segmented-control';

/** The subtitle's line box: one line of 20px whatever it holds, the text's size with its line height. */
const lineOf = (html: string) =>
  /<div class="mt-0\.5 flex min-h-5 items-center text-faint text-\[13(?:\.5)?px\]\/5"/.exec(html);

describe('the page header while its data loads', () => {
  test('a subtitle on its way keeps its line, with a placeholder, in the same box as the text will take', () => {
    const loading = renderToStaticMarkup(<PageHeader title="Transactions" loading />);
    const loaded = renderToStaticMarkup(
      <PageHeader title="Transactions" subtitle="12 en cours · 3 gagnée(s)" />,
    );
    expect(lineOf(loading)).not.toBeNull();
    expect(lineOf(loaded)).not.toBeNull();
    expect(lineOf(loading)![0]).toBe(lineOf(loaded)![0]);
    expect(loading).toContain('data-slot="subtitle-placeholder"');
    expect(loaded).not.toContain('data-slot="subtitle-placeholder"');
    expect(loaded).toContain('12 en cours · 3 gagnée(s)');
  });

  test('no subtitle and nothing loading: no line at all', () => {
    const html = renderToStaticMarkup(<PageHeader title="Apparence" />);
    expect(lineOf(html)).toBeNull();
    expect(html).not.toContain('subtitle-placeholder');
  });

  test('the detail variant keeps its line the same way', () => {
    const loading = renderToStaticMarkup(
      <PageHeader title="Camille Roux" onBack={() => undefined} loading />,
    );
    const loaded = renderToStaticMarkup(
      <PageHeader title="Camille Roux" onBack={() => undefined} subtitle="Lyon" />,
    );
    expect(lineOf(loading)![0]).toBe(lineOf(loaded)![0]);
    expect(loading).toContain('subtitle-placeholder');
  });
});

describe('the segmented control while its counts load', () => {
  test('a count on its way keeps a count’s width; a button that never counts has no slot', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        items={[
          { value: 'today', label: 'Aujourd’hui', count: null },
          { value: 'week', label: 'Cette semaine', count: 27 },
          { value: 'done', label: 'Terminées' },
        ]}
        value="today"
        onChange={() => undefined}
      />,
    );
    expect(html.match(/min-w-\[2ch\]/g)).toHaveLength(2);
    expect(html.match(/data-slot="count-placeholder"/g)).toHaveLength(1);
    expect(html).toMatch(/Cette semaine<span[^>]*min-w-\[2ch\][^>]*>27<\/span>/);
    expect(html).toMatch(/Terminées<\/button>/);
  });
});
