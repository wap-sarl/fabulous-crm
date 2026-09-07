import { readFileSync, writeFileSync } from 'node:fs';

// docs/openapi.yaml is the hand-written source; the generated module is what the deployment serves.
const SRC = new URL('../docs/openapi.yaml', import.meta.url);
const OUT = new URL('../convex/lib/openapi.generated.ts', import.meta.url);

const document = Bun.YAML.parse(readFileSync(SRC, 'utf8'));
const body = `// Generated from docs/openapi.yaml by \`bun run openapi\` — edit the YAML, not this file.
export const openapiDocument: Record<string, unknown> = ${JSON.stringify(document, null, 2)};
`;
writeFileSync(OUT, body);
// Formatted like any committed file, so a regeneration never trips the lint step.
Bun.spawnSync(['bunx', 'biome', 'format', '--write', OUT.pathname], { stdout: 'ignore' });
console.log(`Wrote ${OUT.pathname}`);
