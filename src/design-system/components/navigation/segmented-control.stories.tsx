import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { useEffect, useState } from 'react';
import { useLastDefined } from '../../hooks/useLastDefined';
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

/** Inside something hidden at first (`display: none`, a collapsed section): the pill appears in place when the control is shown, and slides only from then on. */
export const RevealedLater: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.value);
    const [shown, setShown] = useState(false);
    return (
      <div className="space-y-3">
        <button
          type="button"
          className="cursor-pointer text-sm text-soft underline"
          onClick={() => setShown((v) => !v)}
        >
          {shown ? 'Masquer le filtre' : 'Afficher le filtre'}
        </button>
        <div className={shown ? undefined : 'hidden'}>
          <SegmentedControl {...args} value={value} onChange={setValue} />
        </div>
      </div>
    );
  },
};

/** Counts of one to three digits, as on Tâches outside an archive. */
const COUNTS = [3, 12, 27, 140];
const COUNTED_BUCKETS = TASK_BUCKETS.slice(0, 4);
const withCounts = (counts: number[] | undefined) => [
  ...COUNTED_BUCKETS.map((b, i) => ({ ...b, count: counts ? counts[i] : null })),
  TASK_BUCKETS[4]!,
];

/** Counts on their way against counts landed: each button has the same width in both, up to three digits. */
export const CountsLoading: Story = {
  name: 'Counts loading against loaded',
  render: (args) => (
    <div className="space-y-2">
      {(['loading', 'loaded'] as const).map((state) => (
        <div key={state} data-state={state}>
          <SegmentedControl
            {...args}
            items={withCounts(state === 'loaded' ? COUNTS : undefined)}
            value="today"
          />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const widthsOf = (state: string) =>
      [...canvasElement.querySelectorAll(`[data-state="${state}"] button`)].map((b) =>
        Math.round(b.getBoundingClientRect().width),
      );
    await expect(widthsOf('loading')).toEqual(widthsOf('loaded'));
  },
};

/** A query whose arguments follow a scope: its answer is `undefined` for a while after each change. */
function CountsFollowingScope() {
  const [scope, setScope] = useState(0);
  const [answer, setAnswer] = useState<number[] | undefined>(undefined);
  const [value, setValue] = useState('today');
  useEffect(() => {
    setAnswer(undefined);
    const t = setTimeout(() => setAnswer(COUNTS.map((c) => c + scope)), 300);
    return () => clearTimeout(t);
  }, [scope]);
  const counts = useLastDefined(answer);
  return (
    <div className="space-y-3">
      <button
        type="button"
        className="cursor-pointer text-sm text-soft underline"
        onClick={() => setScope((s) => s + 1)}
      >
        Changer de périmètre
      </button>
      <SegmentedControl
        aria-label="Période"
        items={withCounts(counts)}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

/** Counts that follow a filter or a scope: with `useLastDefined`, the last ones stand in while the new ones load, so the buttons show placeholders on the first load only and never move afterwards. */
export const CountsHeldAcrossScopes: Story = {
  name: 'Counts held while a scope changes',
  render: () => <CountsFollowingScope />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const placeholders = () => canvasElement.querySelectorAll('[data-slot="count-placeholder"]');
    await waitFor(() => expect(placeholders()).toHaveLength(0));
    const widths = [...canvasElement.querySelectorAll('fieldset button')].map(
      (b) => b.getBoundingClientRect().width,
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Changer de périmètre' }));
    // The new counts are on their way: the old ones stand in, no placeholder, nothing moved.
    await expect(placeholders()).toHaveLength(0);
    await expect(canvasElement.querySelector('fieldset')?.textContent).toContain('140');
    await waitFor(() =>
      expect(canvasElement.querySelector('fieldset')?.textContent).toContain('141'),
    );
    await expect(
      [...canvasElement.querySelectorAll('fieldset button')].map(
        (b) => b.getBoundingClientRect().width,
      ),
    ).toEqual(widths);
  },
};
