const encoder = new TextEncoder();

function hex(limb: number): string {
  return limb.toString(16).padStart(4, "0");
}

export function diskHash(text: string): string {
  const bytes = encoder.encode(text);
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let index = 0; index < bytes.length; index++) {
    h0 ^= bytes[index];
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3 + (t0 >>> 16);
    const t2 = h2 * 0x1b3 + (t1 >>> 16) + (h0 << 8);
    const t3 = h3 * 0x1b3 + (t2 >>> 16) + (h1 << 8);
    h0 = t0 & 0xffff;
    h1 = t1 & 0xffff;
    h2 = t2 & 0xffff;
    h3 = t3 & 0xffff;
  }
  return hex(h3) + hex(h2) + hex(h1) + hex(h0);
}
