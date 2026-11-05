import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SwitchRow } from './switch-row';

const meta = {
  title: 'Inputs/SwitchRow',
  component: SwitchRow,
  args: {
    label: 'Une transaction vous est attribuée',
    checked: true,
    onCheckedChange: fn(),
  },
  argTypes: { onCheckedChange: { control: false } },
  decorators: [
    (Story) => <div className="w-[480px] rounded-xl border bg-card px-4">{Story()}</div>,
  ],
} satisfies Meta<typeof SwitchRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On. */
export const On: Story = {};

/** Off: the same row, the switch at rest. */
export const Off: Story = { args: { checked: false } };

/** With what the setting does under its label: a channel says where it writes. */
export const Described: Story = {
  args: {
    label: 'E-mail',
    description:
      'Chaque notification vous est aussi envoyée à l’adresse de votre compte, sauf si vous l’avez déjà lue dans le CRM.',
    checked: false,
  },
};

/** While a setting cannot be changed. */
export const Disabled: Story = { args: { disabled: true } };

/** A long label wraps beside the switch, which keeps its size and its place on the right. */
export const LongLabel: Story = {
  name: 'Long label',
  args: {
    label:
      'Une campagne que vous avez créée est terminée ou en échec, quel que soit son canal, e-mail ou SMS',
  },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector('[data-slot="switch-row"]') as HTMLElement;
    const toggle = within(canvasElement).getByRole('switch');
    await expect(Math.round(toggle.getBoundingClientRect().width)).toBe(32);
    await expect(
      Math.round(row.getBoundingClientRect().right - toggle.getBoundingClientRect().right),
    ).toBe(0);
  },
};

function Toggled(args: React.ComponentProps<typeof SwitchRow>) {
  const [checked, setChecked] = useState(args.checked);
  return (
    <SwitchRow
      {...args}
      checked={checked}
      onCheckedChange={(next) => {
        setChecked(next);
        args.onCheckedChange(next);
      }}
    />
  );
}

/** The switch is named by its label and described by the text under it; a click on the label toggles it as a click on the switch does. */
export const LabelToggles: Story = {
  name: 'The label toggles the switch',
  args: { label: 'E-mail', description: 'À l’adresse de votre compte.', checked: false },
  render: (args) => <Toggled {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch', { name: 'E-mail' });
    await expect(toggle).toHaveAccessibleDescription('À l’adresse de votre compte.');
    await expect(toggle).not.toBeChecked();
    await userEvent.click(canvas.getByText('E-mail'));
    await expect(toggle).toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(toggle);
    await expect(toggle).not.toBeChecked();
  },
};
