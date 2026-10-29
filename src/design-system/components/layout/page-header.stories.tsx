import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
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

/** Text mixed with elements: the line is a plain block, so the spaces between them stay. */
export const ListRichSubtitle: Story = {
  name: 'List, rich subtitle',
  args: {
    subtitle: (
      <>
        Créée le <b className="font-medium text-body">12 mars</b> par Lou
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const line = canvasElement.querySelector('[class*="min-h-5"]')!;
    const text = line.firstChild as Text;
    // The text up to its last letter: what follows it must be a space's width, not the next element.
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length - 1);
    const gap =
      line.querySelector('b')!.getBoundingClientRect().left - range.getBoundingClientRect().right;
    await expect(gap).toBeGreaterThan(2);
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

/** The box of a header, and where its parts sit in it: what must not change between loading and loaded. */
const geometryOf = (header: Element) => {
  const box = header.getBoundingClientRect();
  const at = (el: Element | null) =>
    el ? Math.round(el.getBoundingClientRect().top - box.top) : null;
  const h1 = header.querySelector('h1');
  const actions = [...header.querySelectorAll('button')].at(-1) ?? null;
  return {
    width: Math.round(box.width),
    height: Math.round(box.height),
    title: at(h1),
    subtitle: at(header.querySelector('[class*="min-h-5"]')),
    actions: at(actions),
    actionsLabel: actions?.textContent ?? null,
  };
};

/** One action, as on Workflows: narrow enough for the loaded row to fit where a wide placeholder would not. */
const ONE_ACTION = (
  <Button>
    <Plus className="h-4 w-4" />
    Nouveau workflow
  </Button>
);

const NARROW_WIDTHS = [375, 640];

/** On a phone and a little wider, loading against loaded, for a short subtitle: the row must wrap the same way in both states, so the actions do not jump when the data lands. */
export const NarrowLoadingAgainstLoaded: Story = {
  name: 'Narrow: loading against loaded',
  render: () => (
    <div className="space-y-6">
      {(['list', 'detail'] as const).map((variant) =>
        NARROW_WIDTHS.map((width) => (
          <div key={`${variant}-${width}`} className="space-y-2">
            <p className="text-xs text-faint">
              {variant}, {width} px
            </p>
            {(['loading', 'loaded'] as const).map((state) => (
              <div
                key={state}
                className="border border-dashed border-border"
                style={{ width }}
                data-case={`${variant}-${width}`}
                data-state={state}
              >
                <PageHeader
                  className="px-5"
                  variant={variant}
                  title="Workflows"
                  loading={state === 'loading'}
                  subtitle={state === 'loaded' ? '3 workflow(s)' : undefined}
                  actions={ONE_ACTION}
                  onBack={variant === 'detail' ? () => undefined : undefined}
                />
              </div>
            ))}
          </div>
        )),
      )}
    </div>
  ),
  play: async ({ canvasElement }) => {
    for (const variant of ['list', 'detail']) {
      for (const width of NARROW_WIDTHS) {
        const frame = (state: string) =>
          canvasElement.querySelector(
            `[data-case="${variant}-${width}"][data-state="${state}"] > *`,
          )!;
        const loading = geometryOf(frame('loading'));
        const loaded = geometryOf(frame('loaded'));
        await expect({ variant, at: width, ...loading }).toEqual({ variant, at: width, ...loaded });
      }
    }
  },
};
