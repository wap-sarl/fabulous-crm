import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { Button } from './button';
import { Input } from './input';
import { Label } from './label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const ROLES = [
  { key: 'admin', label: 'Administrateur' },
  { key: 'manager', label: 'Manager' },
  { key: 'member', label: 'Membre' },
];

function RoleSelect({ className }: { className?: string }) {
  return (
    <Select defaultValue="member">
      <SelectTrigger className={className} aria-label="Rôle">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r.key} value={r.key}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const meta = {
  title: 'Inputs/Select',
  component: RoleSelect,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof RoleSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { className: 'w-48' },
};

/** The edges of an element, rounded to the pixel. */
const edgesOf = (el: Element | null) => {
  const box = el?.getBoundingClientRect();
  return box ? { top: Math.round(box.top), bottom: Math.round(box.bottom) } : null;
};

/** The « Inviter un membre » row: a labelled input, a labelled select and a button, the three controls on one line, whatever the button's state. Inside a form, the select renders a hidden native one after its trigger, which must not push the trigger up when the column spaces its children. */
export const InAFormRow: Story = {
  name: 'In a form row',
  render: () => (
    <div className="space-y-8">
      {(['idle', 'disabled', 'loading'] as const).map((state) => (
        <form
          key={state}
          className="flex flex-col gap-4 sm:flex-row sm:items-end"
          data-state={state}
          noValidate
        >
          <div className="flex-1 space-y-2">
            <Label
              htmlFor={`invite-email-${state}`}
              className="text-[12.5px] font-semibold text-soft"
            >
              Adresse e-mail
            </Label>
            <Input id={`invite-email-${state}`} type="email" placeholder="collegue@email.fr" />
          </div>
          <div className="space-y-2 sm:w-48">
            <Label className="text-[12.5px] font-semibold text-soft">Rôle</Label>
            <RoleSelect />
          </div>
          <Button type="submit" disabled={state === 'disabled'} loading={state === 'loading'}>
            Inviter
          </Button>
        </form>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const form of canvasElement.querySelectorAll('form')) {
      const state = form.dataset.state;
      const input = edgesOf(form.querySelector('input'));
      const trigger = edgesOf(form.querySelector('[data-slot="select-trigger"]'));
      const button = edgesOf(form.querySelector('button[type="submit"]'));
      await expect({ state, ...trigger }).toEqual({ state, ...input });
      await expect({ state, ...button }).toEqual({ state, ...input });
      const labels = [...form.querySelectorAll('label')].map((l) => edgesOf(l)?.top);
      await expect(labels[1]).toBe(labels[0]);
    }
  },
};

/** Stacked fields in a block column (`space-y-4`) and in a flex column (`flex-col gap-4`, the invite form on a phone): the gap after a select field is the gap after an input field. */
export const StackedInAForm: Story = {
  name: 'Stacked in a form',
  render: () => (
    <div className="flex gap-8">
      {(['block', 'flex'] as const).map((layout) => (
        <form
          key={layout}
          data-layout={layout}
          className={layout === 'block' ? 'w-64 space-y-4' : 'flex w-64 flex-col gap-4'}
          noValidate
        >
          <div className="space-y-2" data-field="input">
            <Label htmlFor={`stacked-email-${layout}`}>Adresse e-mail</Label>
            <Input id={`stacked-email-${layout}`} type="email" />
          </div>
          <div className="space-y-2" data-field="after-input">
            <Label htmlFor={`stacked-name-${layout}`}>Nom</Label>
            <Input id={`stacked-name-${layout}`} />
          </div>
          <div className="space-y-2" data-field="select">
            <Label>Rôle</Label>
            <RoleSelect />
          </div>
          <div className="space-y-2" data-field="after-select">
            <Label htmlFor={`stacked-city-${layout}`}>Ville</Label>
            <Input id={`stacked-city-${layout}`} />
          </div>
        </form>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const form of canvasElement.querySelectorAll('form')) {
      const control = (field: string) =>
        form.querySelector(`[data-field="${field}"] :is(input, [data-slot="select-trigger"])`)!;
      const gapAfter = (field: string, next: string) =>
        Math.round(
          control(next).getBoundingClientRect().top - control(field).getBoundingClientRect().bottom,
        );
      await expect({
        layout: form.dataset.layout,
        gap: gapAfter('select', 'after-select'),
      }).toEqual({
        layout: form.dataset.layout,
        gap: gapAfter('input', 'after-input'),
      });
    }
  },
};
