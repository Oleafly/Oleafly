const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function base64Bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);
}

function bytesBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCodePoint(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function writeUint32(bytes: Uint8Array, at: number, value: number) {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

function physChunk(dpi: number): Uint8Array {
  const perMetre = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  writeUint32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  writeUint32(chunk, 8, perMetre);
  writeUint32(chunk, 12, perMetre);
  chunk[16] = 1;
  writeUint32(chunk, 17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

export function pngWithDpi(pngBase64: string, dpi: number): string {
  const bytes = base64Bytes(pngBase64);
  if (bytes.length < 33 || SIGNATURE.some((value, index) => bytes[index] !== value)) return pngBase64;
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  let inserted = false;
  while (at + 12 <= bytes.length) {
    const length = readUint32(bytes, at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (end > bytes.length) return pngBase64;
    if (type !== "pHYs") kept.push(bytes.subarray(at, end));
    if (type === "IHDR" && !inserted) {
      kept.push(physChunk(dpi));
      inserted = true;
    }
    at = end;
  }
  if (!inserted) return pngBase64;
  const out = new Uint8Array(kept.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    out.set(part, offset);
    offset += part.length;
  }
  return bytesBase64(out);
}

export async function sha1Prefix(text: string, length = 16): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}
