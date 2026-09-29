import type { ApiScope, Id } from '@crm/lib/backend';

export type ApiKeyRow = {
  _id: Id<'apiKeys'>;
  keyId: string;
  name: string;
  scopes: ApiScope[];
  expiresAt?: number;
  revokedAt?: number;
  lastUsedAt?: number;
  createdAt: number;
};
