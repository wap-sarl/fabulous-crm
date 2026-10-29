import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SegmentedControl } from '../../src/design-system/components/navigation/segmented-control';

const ITEMS = [
  { value: 'overdue', label: 'En retard', count: 3 },
  { value: 'today', label: 'Aujourd’hui', count: 12 },
  { value: 'undated', label: 'Sans date' },
];

describe('the segmented control', () => {
  test('a group of buttons, one pressed, said so to assistive technology: a filter, not tabs; the moving pill is decoration', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        aria-label="Période"
        items={ITEMS}
        value="today"
        onChange={() => undefined}
      />,
    );
    expect(html).toMatch(/<fieldset[^>]*aria-label="Période"/);
    expect(html).not.toContain('role="tab');
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Aujourd’hui<span[^>]*>12<\/span>/);
    expect(html).toContain('data-slot="segmented-pill"');
    expect(html).toMatch(/<span aria-hidden="true" data-slot="segmented-pill"/);
  });

  test('the pill takes no place until measured and does not move before it has been placed: on a first display it appears where it is', () => {
    const html = renderToStaticMarkup(
      <SegmentedControl items={ITEMS} value="undated" onChange={() => undefined} />,
    );
    const pill = /<span aria-hidden="true" data-slot="segmented-pill" class="([^"]*)"/.exec(
      html,
    )![1]!;
    expect(pill).toContain('absolute');
    // Nothing measured on the server: the pill is there, invisible, without a transition yet, and no button paints its own background.
    expect(pill).toContain('opacity-0');
    expect(pill).not.toContain('transition');
    expect(html).not.toMatch(/<button[^>]*bg-card/);
  });
});
