import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import { NotificationBell } from './notification-bell';

const meta = {
  title: 'Navigation/NotificationBell',
  component: NotificationBell,
  args: { onClick: fn() },
  argTypes: { onClick: { control: false } },
} satisfies Meta<typeof NotificationBell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The count is still on its way: the bell alone, no badge. */
export const Loading: Story = { args: { count: undefined } };

/** Nothing unread: the same bell, no badge. */
export const Quiet: Story = { args: { count: 0 } };

/** A few unread. */
export const Unread: Story = { args: { count: 5 } };

/** The count is read up to a cap: past 99 the badge says so, and no number is counted in full. */
export const Many: Story = { args: { count: 150 } };

/** The states side by side: the badge sits over the button's corner, so the button keeps one box whatever the count, and nothing beside it moves when the count lands. */
export const StableBox: Story = {
  name: 'One box whatever the count',
  args: { count: 0 },
  render: (args) => (
    <div className="flex items-center gap-4">
      {[undefined, 0, 5, 150].map((count, i) => (
        <span key={String(i)} data-count={String(count)} className="inline-flex">
          <NotificationBell {...args} count={count} />
        </span>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const boxes = [...canvasElement.querySelectorAll('[data-slot="notification-bell"]')].map(
      (bell) => {
        const { width, height } = bell.getBoundingClientRect();
        return [Math.round(width), Math.round(height)];
      },
    );
    await expect(boxes).toHaveLength(4);
    for (const box of boxes) await expect(box).toEqual(boxes[0]);
    const badges = [...canvasElement.querySelectorAll('[data-slot="notification-badge"]')].map(
      (b) => b.textContent,
    );
    await expect(badges).toEqual(['5', '99+']);
  },
};
