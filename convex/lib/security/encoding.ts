export const encoder = new TextEncoder();
export const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
export const fromBase64Url = (text: string): string =>
  atob(
    text
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(text.length / 4) * 4, '='),
  );
export const bufferOf = (text: string): ArrayBuffer => {
  const bytes = encoder.encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};
