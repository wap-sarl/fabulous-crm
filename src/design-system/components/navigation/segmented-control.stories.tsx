import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SegmentedControl } from './segmented-control';

const TASK_BUCKETS = [
  { value: 'overdue', label: 'En retard', count: 3 },
  { value: 'today', label: 'Aujourd’hui', count: 12 },
  { value: 'week', label: 'Cette semaine', count: 27 },
  { value: 'later', label: 'Plus tard', count: 140 },
  { value: 'undated', label: 'Sans date' },
  { value: 'done', label: 'Terminées', count: 1024 },
];

const meta = {
  title: 'Navigation/SegmentedControl',
  component: SegmentedControl,
  args: { 'aria-label': 'Période', items: TASK_BUCKETS, value: 'today', onChange: () => undefined },
  argTypes: { onChange: { control: false }, items: { control: false } },
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <SegmentedControl {...args} value={value} onChange={setValue} />;
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The pill slides to the chosen button and takes its width, counts included; the selection changes at once. */
export const WithCounts: Story = {};

export const LabelsOnly: Story = {
  args: {
    'aria-label': 'Canal',
    items: [
      { value: 'all', label: 'Tous' },
      { value: 'email', label: 'E-mail' },
      { value: 'sms', label: 'SMS' },
    ],
    value: 'all',
  },
};

/** Wider than its place: the list scrolls, the pill scrolls with it. */
export const Overflowing: Story = {
  args: { className: 'max-w-xs' },
};
