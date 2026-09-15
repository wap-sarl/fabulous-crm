const OTP_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateHexToken(bytes = 32): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function generateAlphanumericOtp(length = 6): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => OTP_CHARS[byte % OTP_CHARS.length]).join('');
}

export function generateNumericOtp(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 10).toString()).join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

// Secrets at rest: AES-256-GCM through Web Crypto, master key in SECRETS_KEY, ciphertext `v1:<iv>:<data>` (base64).
// SECRETS_KEY_NEXT rotates: new writes use it, reads try it first, then SECRETS_KEY.

const SECRET_VERSION = 'v1';
const keys = new Map<string, Promise<CryptoKey>>();
let warnedClear = false;

function keyFor(hex: string): Promise<CryptoKey> {
  let key = keys.get(hex);
  if (!key) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('SECRETS_KEY must be 32 bytes in hex (openssl rand -hex 32)');
    }
    const raw = Uint8Array.from(hex.match(/../g) as string[], (b) => Number.parseInt(b, 16));
    key = crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    keys.set(hex, key);
  }
  return key;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The keys that may decrypt, newest first; empty when secrets live in clear. */
function readKeys(): string[] {
  return [process.env.SECRETS_KEY_NEXT, process.env.SECRETS_KEY].filter(
    (k): k is string => !!k && k.trim() !== '',
  );
}

export const secretsKeyConfigured = (): boolean => readKeys().length > 0;

export const isEncryptedSecret = (value: string): boolean => value.startsWith(`${SECRET_VERSION}:`);

/** Ciphertext for a stored secret; the clear value when no key is configured (community edition), with one warning. */
export async function encryptSecret(plain: string): Promise<string> {
  if (plain === '') return plain;
  const [hex] = readKeys();
  if (!hex) {
    if (!warnedClear) {
      warnedClear = true;
      console.warn('[secrets] SECRETS_KEY is not set: stored secrets are kept in clear');
    }
    return plain;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFor(hex),
    new TextEncoder().encode(plain),
  );
  return `${SECRET_VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(data))}`;
}

/** The clear value of a stored secret; a value written before encryption comes back as is. */
export async function decryptSecret(stored: string): Promise<string> {
  if (!isEncryptedSecret(stored)) return stored;
  const [, ivText, dataText] = stored.split(':');
  if (!ivText || !dataText) throw new Error('secret_ciphertext_malformed');
  const candidates = readKeys();
  if (candidates.length === 0) throw new Error('secret_key_missing');
  for (const hex of candidates) {
    try {
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(ivText) },
        await keyFor(hex),
        fromBase64(dataText),
      );
      return new TextDecoder().decode(clear);
    } catch {}
  }
  throw new Error('secret_key_mismatch');
}
