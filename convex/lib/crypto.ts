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
