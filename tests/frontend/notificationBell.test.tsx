import { describe, expect, test } from 'bun:test';
import { Users } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotificationItem } from '../../src/design-system/components/data-display/notification-item';
import {
  bellBadgeText,
  NotificationBell,
} from '../../src/design-system/components/navigation/notification-bell';
import { formatRelativeTime } from '../../src/lib/format';

describe('the bell', () => {
  test('no badge while the count loads or when nothing is unread, the count otherwise, « 99+ » past the cap', () => {
    expect(renderToStaticMarkup(<NotificationBell count={undefined} />)).not.toContain(
      'notification-badge',
    );
    expect(renderToStaticMarkup(<NotificationBell count={0} />)).not.toContain(
      'notification-badge',
    );
    const five = renderToStaticMarkup(<NotificationBell count={5} />);
    expect(five).toMatch(/data-slot="notification-badge"[^>]*>5</);
    expect(five).toContain('aria-label="Notifications, 5 non lue(s)"');
    expect(renderToStaticMarkup(<NotificationBell count={150} />)).toMatch(
      /data-slot="notification-badge"[^>]*>99\+</,
    );
    expect(bellBadgeText(99)).toBe('99');
    expect(bellBadgeText(100)).toBe('99+');
  });

  test('the badge is positioned over the button, outside its flow, so the button is one box whatever the count', () => {
    const html = renderToStaticMarkup(<NotificationBell count={12} />);
    expect(html).toMatch(/data-slot="notification-bell"[^>]*class="[^"]*\brelative\b/);
    expect(html).toMatch(/data-slot="notification-badge"[^>]*class="[^"]*\babsolute\b/);
  });
});

describe('the item', () => {
  const item = (unread: boolean) =>
    renderToStaticMarkup(
      <NotificationItem
        icon={Users}
        tone="blue"
        title="Lead attribué : Camille Roux"
        body="Lou vous a attribué le lead."
        time="il y a 5 minutes"
        unread={unread}
      />,
    );
  test('unread carries the attribute and the dot, read keeps the dot’s place without painting it', () => {
    expect(item(true)).toContain('data-unread=""');
    expect(item(true)).toMatch(/data-slot="unread-dot"[^>]*class="[^"]*bg-primary"/);
    expect(item(false)).not.toContain('data-unread');
    expect(item(false)).toMatch(/data-slot="unread-dot"[^>]*class="[^"]*bg-transparent"/);
  });
});

describe('the relative time', () => {
  const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
  test('words the largest unit the distance fills, in French', () => {
    expect(formatRelativeTime(NOW - 20_000, NOW)).toBe('à l’instant');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('il y a 5 minutes');
    expect(formatRelativeTime(NOW - 2 * 3_600_000, NOW)).toBe('il y a 2 heures');
    expect(formatRelativeTime(NOW - 24 * 3_600_000, NOW)).toBe('hier');
    expect(formatRelativeTime(NOW - 40 * 24 * 3_600_000, NOW)).toBe('le mois dernier');
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe('à l’instant');
  });
});
