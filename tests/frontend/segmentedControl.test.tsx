import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SegmentedControl } from '../../src/design-system/components/navigation/segmented-control';

const ITEMS = [
  { value: 'overdue', label: 'En retard', count: 3 },
  { value: 'today', label: 'Aujourd’hui', count: 12 },
  { value: 'undated', label: 'Sans date' },
];

describe('the segmented control', () => {
  test('one tab is selected, said so to assistive technology; the moving pill is decoration', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        aria-label="Période"
        items={ITEMS}
        value="today"
        onChange={() => undefined}
      />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Période"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*>Aujourd’hui<span[^>]*>12<\/span>/);
    expect(html).toContain('data-slot="segmented-pill"');
    expect(html).toMatch(/<span aria-hidden="true" data-slot="segmented-pill"/);
  });

  test('the pill moves in 200 ms, not at all for someone who asked for less motion, and takes no place until measured', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl items={ITEMS} value="undated" onChange={() => undefined} />,
    );
    const pill = /<span aria-hidden="true" data-slot="segmented-pill" class="([^"]*)"/.exec(
      html,
    )![1]!;
    expect(pill).toContain('transition-[transform,width]');
    expect(pill).toContain('duration-200');
    expect(pill).toContain('motion-reduce:transition-none');
    expect(pill).toContain('absolute');
    // Nothing measured on the server: the pill is there, invisible, and no button paints its own background.
    expect(pill).toContain('opacity-0');
    expect(html).not.toMatch(/<button[^>]*bg-card/);
  });
});
