const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in chunks: a per-byte string concat freezes the UI
  // on multi-MB buffers (large PDFs). fromCodePoint over 32KB subarrays is
  // well under the argument-count limit and avoids the O(n^2) concat.
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCodePoint(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.codePointAt(index) ?? 0;
  return bytes;
}
