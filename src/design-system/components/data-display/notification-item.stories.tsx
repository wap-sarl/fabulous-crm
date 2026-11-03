import type { Meta, StoryObj } from '@storybook/react-vite';
import { Handshake, ListTodo, Megaphone, Upload, Users } from 'lucide-react';
import { fn } from 'storybook/test';
import { NotificationItem } from './notification-item';

const meta = {
  title: 'Data display/NotificationItem',
  component: NotificationItem,
  args: {
    icon: Users,
    tone: 'blue',
    title: 'Lead attribué : Camille Roux',
    body: 'Lou Martin vous a attribué le lead Camille Roux.',
    time: 'il y a 5 minutes',
    unread: true,
    onClick: fn(),
  },
  argTypes: { icon: { control: false }, onClick: { control: false } },
  decorators: [(Story) => <div className="w-[360px] rounded-xl border bg-card p-1">{Story()}</div>],
} satisfies Meta<typeof NotificationItem>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Unread: the bold title and the dot. */
export const Unread: Story = {};

/** Read: the same row, lighter, without the dot. */
export const Read: Story = { args: { unread: false } };

/** The popover's rows: tighter, the body on one line. */
export const Compact: Story = {
  args: {
    compact: true,
    body: 'Lou Martin a déplacé la transaction au stade « Négociation », après un appel qui a duré une bonne heure.',
  },
};

/** One row per group, with the group's icon and tone. */
export const Groups: Story = {
  render: (args) => (
    <ul className="space-y-1">
      <li>
        <NotificationItem {...args} />
      </li>
      <li>
        <NotificationItem
          {...args}
          icon={Handshake}
          tone="green"
          title="Transaction gagnée : Clinique Nord"
          body="Lou Martin a marqué la transaction gagnée."
          time="il y a 2 heures"
        />
      </li>
      <li>
        <NotificationItem
          {...args}
          icon={ListTodo}
          tone="amber"
          title="Tâche attribuée : Rappeler le cabinet"
          body="Lou Martin vous a attribué la tâche Rappeler le cabinet."
          time="hier"
          unread={false}
        />
      </li>
      <li>
        <NotificationItem
          {...args}
          icon={Megaphone}
          tone="violet"
          title="Campagne terminée : Newsletter de novembre"
          body="312 envoi(s) réussi(s), 4 en échec."
          time="il y a 3 jours"
          unread={false}
        />
      </li>
      <li>
        <NotificationItem
          {...args}
          icon={Upload}
          tone="gray"
          title="Import terminé : contacts.csv"
          body="118 créé(s), 12 mis à jour, 2 en erreur."
          time="il y a 2 mois"
          unread={false}
        />
      </li>
    </ul>
  ),
};
