import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from './button';
import { SecretField } from './secret-field';
import { SwitchRow } from './switch-row';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/abcdef';
const onlySlack = (value: string) =>
  value.startsWith('https://hooks.slack.com/services/')
    ? null
    : 'Collez l’URL d’un webhook entrant Slack, de la forme https://hooks.slack.com/services/…';

const meta = {
  title: 'Inputs/SecretField',
  component: SecretField,
  args: {
    label: 'URL de votre webhook entrant',
    placeholder: 'https://hooks.slack.com/services/…',
    set: false,
    validate: onlySlack,
    onSave: fn(),
    onRemove: fn(),
  },
  argTypes: {
    validate: { control: false },
    onSave: { control: false },
    onRemove: { control: false },
  },
  decorators: [
    (Story) => <div className="w-[560px] rounded-xl border bg-card px-4 py-3">{Story()}</div>,
  ],
} satisfies Meta<typeof SecretField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing kept yet: the field and its button. */
export const Empty: Story = {};

/** A value is kept: only the part that may be shown is said, here the host of the address. */
export const Kept: Story = { args: { set: true, hint: 'hooks.slack.com · T0123ABC' } };

/** Kept, with nothing that may be shown of it. */
export const KeptWithoutHint: Story = { name: 'Kept, no hint', args: { set: true } };

/** With something more to do with the kept value, before « Modifier »: here a test of it. */
export const WithAction: Story = {
  name: 'Kept, with an action',
  args: {
    set: true,
    hint: 'hooks.slack.com · T0123ABC',
    actions: (
      <Button variant="ghost" size="sm">
        Tester
      </Button>
    ),
  },
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button');
    await expect(buttons.map((button) => button.textContent)).toEqual([
      'Tester',
      'Modifier',
      'Retirer',
    ]);
  },
};

/** A value that cannot be taken back, only replaced: no « Retirer ». */
export const ReplaceOnly: Story = {
  name: 'Replace only',
  args: { set: true, hint: 'hooks.slack.com', onRemove: undefined },
};

function Channel(args: React.ComponentProps<typeof SecretField>) {
  const [set, setSet] = useState(args.set);
  const [enabled, setEnabled] = useState(args.set);
  return (
    <div>
      <SwitchRow
        label="Slack"
        description="Chaque notification vous est aussi envoyée dans Slack, par votre webhook entrant."
        checked={enabled}
        onCheckedChange={setEnabled}
        disabled={!set}
      />
      <SecretField
        {...args}
        className="pb-3"
        set={set}
        hint={set ? 'hooks.slack.com' : undefined}
        onSave={async (value) => {
          await args.onSave(value);
          setSet(true);
          setEnabled(true);
        }}
        onRemove={async () => {
          await args.onRemove?.();
          setSet(false);
          setEnabled(false);
        }}
      />
    </div>
  );
}

/** A channel's row on the notification settings: the switch waits for the address; what is typed is checked before it is sent, kept it is never shown again, and taking it back turns the channel off. The focus is never dropped: it goes to the field when one opens, back to « Modifier » when it closes. */
export const ChannelTarget: Story = {
  name: 'A channel and its target',
  render: (args) => <Channel {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('switch', { name: 'Slack' });
    await expect(toggle).toBeDisabled();

    const field = canvas.getByLabelText('URL de votre webhook entrant');
    await userEvent.click(canvas.getByRole('button', { name: 'Enregistrer' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('Ce champ est vide.');
    await expect(field).toHaveFocus();
    await userEvent.type(field, 'https://example.com/hook');
    await expect(canvas.queryByRole('alert')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Enregistrer' }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('webhook entrant Slack');
    await expect(field).toHaveAccessibleDescription(/webhook entrant Slack/);
    await expect(args.onSave).not.toHaveBeenCalled();

    await userEvent.clear(field);
    await userEvent.type(field, `  ${WEBHOOK} {Enter}`);
    await expect(args.onSave).toHaveBeenCalledWith(WEBHOOK);
    await expect(await canvas.findByText('Configuré')).toBeVisible();
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Modifier' })).toHaveFocus());
    await expect(canvas.getByText(/hooks\.slack\.com/)).toBeVisible();
    await expect(canvasElement.textContent).not.toContain('abcdef');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toBeChecked();

    // Replacing opens an empty field; cancelling leaves what is kept.
    await userEvent.click(canvas.getByRole('button', { name: 'Modifier' }));
    await expect(canvas.getByLabelText('URL de votre webhook entrant')).toHaveValue('');
    await expect(canvas.getByLabelText('URL de votre webhook entrant')).toHaveFocus();
    await userEvent.click(canvas.getByRole('button', { name: 'Annuler' }));
    await expect(canvas.getByText('Configuré')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Modifier' })).toHaveFocus();

    await userEvent.click(canvas.getByRole('button', { name: 'Retirer' }));
    await expect(args.onRemove).toHaveBeenCalled();
    const reopened = await canvas.findByLabelText('URL de votre webhook entrant');
    await waitFor(() => expect(reopened).toHaveFocus());
    await expect(toggle).toBeDisabled();
  },
};

/** A save the server refuses leaves the field open with what was typed. */
export const SaveRefused: Story = {
  name: 'A refused save',
  args: { onSave: fn(() => Promise.reject(new Error('refused'))) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByLabelText('URL de votre webhook entrant');
    await userEvent.type(field, `${WEBHOOK}{Enter}`);
    await expect(args.onSave).toHaveBeenCalledWith(WEBHOOK);
    await expect(field).toHaveValue(WEBHOOK);
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
  },
};
