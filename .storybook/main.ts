import type { StorybookConfig } from '@storybook/react-vite';

/** One story file next to what it documents: the components of the design system, the system e-mails beside the auth widget. */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-vitest'],
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
