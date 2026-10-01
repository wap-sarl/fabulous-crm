import { api } from '../../convex/_generated/api';
import type { ApiScope } from '../../convex/_lib/validators/apiKeys';
import type { asIdentity, T } from './helpers';

export const ALL_READ_SCOPES: ApiScope[] = [
  'contacts:read',
  'companies:read',
  'deals:read',
  'activities:read',
  'lists:read',
  'properties:read',
];

type As = ReturnType<typeof asIdentity>;

export function createKey(as: As, scopes: ApiScope[] = ALL_READ_SCOPES, expiresAt?: number) {
  return as.mutation(api.features.api.mutations.createApiKey, {
    name: 'Test key',
    scopes,
    expiresAt,
  });
}

export const apiGet = (t: T, path: string, key?: string) =>
  t.fetch(`/api/v1/${path}`, {
    method: 'GET',
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });

export const apiCall = (
  t: T,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  key: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  t.fetch(`/api/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

export type ErrorBody = {
  error: { code: string; message: string; details?: Record<string, unknown> };
};
export const errorCode = async (res: Response) => ((await res.json()) as ErrorBody).error.code;
