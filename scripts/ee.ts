import { cpSync } from 'node:fs';

const mode = process.argv[2];
const stubs = new URL('../convex/ee/', import.meta.url);
if (mode === 'enable') {
  cpSync(new URL('../ee/convex/', import.meta.url), stubs, { recursive: true });
  console.log('convex/ee now holds the paid modules; do not commit this state.');
} else if (mode === 'disable') {
  const result = Bun.spawnSync(['git', 'checkout', '--', 'convex/ee']);
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  console.log('convex/ee restored to the community stubs.');
} else {
  throw new Error('Usage: bun run scripts/ee.ts enable|disable');
}
