import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileSpreadsheet } from 'lucide-react';
import { useRef } from 'react';
import { fn } from 'storybook/test';
import { Button } from './button';
import { Dropzone, type DropzoneHandle } from './dropzone';
import { Label } from './label';

/** A stand-in for an uploaded image: the frame of the zone fits it like a logo or a favicon. */
function SampleImage() {
  return (
    <svg viewBox="0 0 24 24" className="size-10 text-primary" role="img" aria-label="Aperçu">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
    </svg>
  );
}

const meta = {
  title: 'Inputs/Dropzone',
  component: Dropzone,
  args: {
    id: 'dropzone',
    onFiles: fn(),
  },
  argTypes: {
    onFiles: { control: false },
    ref: { control: false },
    children: { control: false },
    preview: { control: false },
    icon: { control: false },
    description: { control: false },
  },
  decorators: [
    (Story) => (
      <div className="max-w-md space-y-2">
        <Label htmlFor="dropzone">Fichier</Label>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Dropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The formats and the ceiling come from `accept` and `maxBytes`, so what is announced is what is checked; `hint` is the recommendation the zone does not check. */
export const Empty: Story = {
  args: {
    accept: ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp'],
    maxBytes: 1024 * 1024,
    hint: 'Fond transparent recommandé.',
  },
};

/** Several files at once; the ceiling is per file. A single zone refuses a drop of several files. */
export const Multiple: Story = {
  args: { multiple: true, maxBytes: 10 * 1024 * 1024 },
};

/** A loaded image in the wide frame of a logo; the button reads « Remplacer ». */
export const FilledWide: Story = {
  name: 'Filled, wide (logo)',
  args: {
    accept: ['image/png', 'image/svg+xml'],
    maxBytes: 1024 * 1024,
    preview: <SampleImage />,
    previewShape: 'wide',
    hint: 'Fond transparent recommandé.',
  },
};

/** A loaded image in the square frame of a favicon. */
export const FilledSquare: Story = {
  name: 'Filled, square (favicon)',
  args: {
    accept: ['image/png', 'image/svg+xml', 'image/x-icon'],
    maxBytes: 1024 * 1024,
    preview: <SampleImage />,
    previewShape: 'square',
    hint: 'Image carrée, 32×32 ou plus.',
  },
};

/** A file that is not an image: its icon stays, `description` says what is known of it. */
export const LoadedFile: Story = {
  args: {
    accept: ['.csv', '.xlsx'],
    icon: <FileSpreadsheet aria-hidden="true" />,
    actionLabel: 'Remplacer',
    description: (
      <>
        <span className="font-mono">contacts.csv</span> · 1 240 ligne(s)
      </>
    ),
  },
};

/** While a file is read or sent: the zone says so, and takes nothing meanwhile. */
export const Busy: Story = {
  args: { busy: true, busyLabel: 'Envoi… 2/3' },
};

/** The consumer's own error, next to the field and announced; a refused file is shown the same way by the zone itself. */
export const WithError: Story = {
  name: 'Error',
  args: {
    accept: ['.html', '.htm'],
    maxBytes: 800 * 1024,
    error: 'L’envoi du fichier a échoué ; l’image précédente est conservée. Réessayez.',
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** The zone wraps the consumer's own list, and a button outside opens the picker through the ref. */
export const WithContent: Story = {
  args: { multiple: true, maxBytes: 10 * 1024 * 1024, busy: true, busyLabel: 'Envoi… 1/2' },
  render: (args) => {
    const zone = useRef<DropzoneHandle>(null);
    return (
      <div className="space-y-2">
        <Button variant="ghost" size="sm" onClick={() => zone.current?.open()}>
          Ajouter
        </Button>
        <Dropzone {...args} ref={zone}>
          <ul className="divide-y text-sm">
            <li className="px-2 py-1.5">devis-2026.pdf</li>
            <li className="px-2 py-1.5">photo-chantier.jpg</li>
          </ul>
        </Dropzone>
      </div>
    );
  },
};
