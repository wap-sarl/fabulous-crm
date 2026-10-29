import type { Preview } from '@storybook/react-vite';
import '../src/styles.css';

/** The theme of the CRM, and a page of docs for every component. */
const preview: Preview = {
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
  },
  tags: ['autodocs'],
};

export default preview;
