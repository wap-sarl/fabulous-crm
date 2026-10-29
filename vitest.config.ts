import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.mjs';

// A Chromium installed into the project (see the README: bun's fetch fails on Playwright's download) is found there.
const localBrowsers = path.join(import.meta.dirname, 'node_modules/.cache/ms-playwright');
if (existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH ??= localBrowsers;

/** The stories run as tests in a real Chromium, headless: what a story's `play` asserts about geometry needs a layout engine, which `bun test` has not. The app's Vite config comes along, for the theme and the alias. */
export default mergeConfig(
  viteConfig,
  defineConfig({
    plugins: [storybookTest({ configDir: '.storybook' })],
    test: {
      name: 'storybook',
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
);
