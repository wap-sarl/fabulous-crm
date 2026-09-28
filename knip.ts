import type { KnipConfig } from 'knip';

// Convex calls its functions by path: the modules that define them are entry points.
const convexEntries = [
  'convex/{http,crons,auth,auth.config,convex.config,schema,migrations}.ts',
  'convex/auth/**/*.ts',
  'convex/features/**/{queries,mutations,actions,internal,writes}.ts',
  'convex/{seed,setup}/**/*.ts',
];
// The extension seam: what the overlay replaces and the types it builds on.
const seam = [
  'convex/{extensions,extensionsSchema}.ts',
  'src/extensions.tsx',
  'src/lib/extensionTypes.ts',
];

const config: KnipConfig = {
  entry: [...convexEntries, ...seam, 'scripts/*.ts', 'tests/**/*.test.ts'],
  project: [
    'src/**/*.{ts,tsx,css}',
    'convex/**/*.ts',
    '!convex/_generated/**',
    'scripts/**/*.ts',
    'tests/**/*.ts',
  ],
  // The tool's Convex plugin takes every backend file for an entry point, which hides unused exports: the entries above say it better.
  convex: false,
};

export default config;
