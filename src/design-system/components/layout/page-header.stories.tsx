import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus, Upload } from 'lucide-react';
import { StatusBadge } from '../data-display/status-badge';
import { Button } from '../inputs/button';
import { PageHeader } from './page-header';

const ACTIONS = (
  <div className="flex gap-2">
    <Button variant="outline">
      <Upload className="h-4 w-4" />
      Importer
    </Button>
    <Button>
      <Plus className="h-4 w-4" />
      Nouvelle transaction
    </Button>
  </div>
);

const meta = {
  title: 'Layout/PageHeader',
  component: PageHeader,
  args: { title: 'Transactions', actions: ACTIONS },
  argTypes: {
    actions: { control: false },
    leading: { control: false },
    titleExtra: { control: false },
  },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="px-7">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The summary under the title comes from the data. */
export const List: Story = {
  args: { subtitle: '12 en cours · 48 300 € · 3 gagnée(s)' },
};

/** The same header while its data loads: the subtitle's line is kept, so nothing moves when the summary lands. */
export const ListLoading: Story = {
  name: 'List, loading',
  args: { loading: true },
};

/** No subtitle at all: no line reserved. */
export const ListWithoutSubtitle: Story = {
  name: 'List, no subtitle',
  args: {},
};

/** A subtitle long enough to wrap grows the line, as text does. */
export const ListWrapping: Story = {
  name: 'List, wrapping subtitle',
  args: {
    subtitle:
      'Les e-mails réutilisables de la bibliothèque, chargés dans les campagnes et les workflows, et les blocs de texte tapés par raccourci dans l’éditeur, avec leurs variables.',
  },
};

export const Detail: Story = {
  args: {
    title: 'Camille Roux',
    subtitle: 'Pharmacie du Centre · Lyon',
    onBack: () => undefined,
    titleExtra: <StatusBadge tone="green">Client</StatusBadge>,
    actions: <Button variant="outline">Modifier</Button>,
  },
};

export const DetailLoading: Story = {
  name: 'Detail, loading',
  args: {
    title: 'Camille Roux',
    loading: true,
    onBack: () => undefined,
    actions: <Button variant="outline">Modifier</Button>,
  },
};
