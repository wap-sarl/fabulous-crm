import type { StorybookConfig } from '@storybook/react-vite';

/** The components of the design system, one story file next to each component it documents. */
const config: StorybookConfig = {
  stories: ['../src/design-system/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    // The app's chunk limit guards the app's bundle; Storybook's own runtime is bigger than it and not the app.
    plugins: viteConfig.plugins
      ?.flat()
      .filter((plugin) => !(plugin && 'name' in plugin && plugin.name === 'crm:chunk-limit')),
  }),
};

export default config;
