import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';
import { API_ROUTE_TABLE } from '../../convex/features/api/routes';
import { openapiDocument } from '../../convex/lib/openapi.generated';
import { createTestConvex } from './helpers';

const YAML_PATH = new URL('../../docs/openapi.yaml', import.meta.url);
const HTTP_METHODS = ['get', 'post', 'patch', 'delete', 'put'] as const;

type Operation = { 'x-scopes'?: string[]; security?: unknown[] };
type Paths = Record<string, Record<string, Operation>>;

/** `contacts/:id` → `/contacts/{id}`. */
const specPath = (pattern: string) => `/${pattern.replace(/:(\w+)/g, '{$1}')}`;

describe('OpenAPI document', () => {
  test('the generated module is in sync with docs/openapi.yaml', () => {
    const fromYaml = Bun.YAML.parse(readFileSync(YAML_PATH, 'utf8'));
    // Regenerate with `bun run openapi` when this fails.
    expect(openapiDocument).toEqual(fromYaml as Record<string, unknown>);
  });

  test('is valid OpenAPI 3.1 with resolvable references', async () => {
    const api = await SwaggerParser.validate(structuredClone(openapiDocument) as never);
    expect((api as { openapi: string }).openapi).toBe('3.1.0');
  });

  test('describes exactly the routes of the router, with their scopes', () => {
    const paths = openapiDocument.paths as Paths;
    const documented = new Set<string>();
    for (const [path, item] of Object.entries(paths)) {
      for (const method of HTTP_METHODS) {
        if (item[method]) documented.add(`${method.toUpperCase()} ${path}`);
      }
    }
    for (const route of API_ROUTE_TABLE) {
      const key = `${route.method} ${specPath(route.pattern)}`;
      expect(documented.has(key)).toBe(true);
      documented.delete(key);
      const operation = paths[specPath(route.pattern)][route.method.toLowerCase()];
      const scopes = route.scope === undefined ? undefined : [route.scope].flat();
      expect(operation['x-scopes']).toEqual(scopes);
    }
    // Nothing documented that the router does not serve.
    expect([...documented]).toEqual([]);
  });

  test('is served without a key, with servers pointing at the deployment', async () => {
    const t = createTestConvex();
    const spec = await t.fetch('/api/v1/openapi.json', { method: 'GET' });
    expect(spec.status).toBe(200);
    expect(spec.headers.get('Content-Type')).toContain('application/json');
    const body = (await spec.json()) as {
      openapi: string;
      servers: { url: string }[];
      paths: Paths;
    };
    expect(body.openapi).toBe('3.1.0');
    expect(body.servers[0].url).toMatch(/^https?:\/\/.+\/api\/v1$/);
    expect(Object.keys(body.paths)).toContain('/contacts');

    const docs = await t.fetch('/api/v1/docs', { method: 'GET' });
    expect(docs.status).toBe(200);
    expect(docs.headers.get('Content-Type')).toContain('text/html');
    expect(await docs.text()).toContain('/api/v1/openapi.json');

    // Everything else under the prefix still needs a key.
    expect((await t.fetch('/api/v1/contacts', { method: 'GET' })).status).toBe(401);
  });
});
