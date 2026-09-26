import { describe, expect, it } from "vitest";
import { diskHash } from "./disk-hash";

function reference(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

describe("diskHash", () => {
  it("matches the backend source hash vectors", () => {
    expect(diskHash("")).toBe("cbf29ce484222325");
    expect(diskHash("a")).toBe("af63dc4c8601ec8c");
  });

  it("hashes the UTF-8 bytes the backend reads from disk", () => {
    for (const text of [
      "\\section{Úvod}\r\nPrvní řádek.\r\n",
      "Привет, мир\n",
      "日本語のテキスト😀\n",
      "\uFEFFbom\n",
      "x".repeat(4096),
      "Příliš žluťoučký kůň 😀 úpěl.\r\n\u0301".repeat(2000),
      "\u{10FFFF}\u0000\u00FF",
    ]) {
      expect(diskHash(text)).toBe(reference(text));
    }
  });
});
