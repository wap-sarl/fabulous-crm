import type { EntitlementsPayload } from '../../convex/_lib/validators/entitlements';

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;

export interface EntitlementsKeyPair {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}

/** Only the public half is ever committed (convex/lib/entitlementsKeys.ts). */
export async function generateEntitlementsKeyPair(): Promise<EntitlementsKeyPair> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateJwk, publicJwk: { kty, crv, x, y } };
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `base64url(payload).base64url(signature)`; the signature covers the encoded payload bytes. */
export async function signEntitlements(
  privateJwk: JsonWebKey,
  payload: EntitlementsPayload,
): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALGORITHM, false, ['sign']);
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${encodeBase64Url(new Uint8Array(signature))}`;
}
