import { describe, expect, it } from "vitest";
import { bytesToBase64, slugifyFigureName } from "./figure";

describe("slugifyFigureName", () => {
  it("collapses punctuation and trims the dashes it introduces", () => {
    expect(slugifyFigureName("Transformer Encoder (6 blocks)!")).toBe("transformer-encoder-6-blocks");
    expect(slugifyFigureName("---leading and trailing---")).toBe("leading-and-trailing");
    expect(slugifyFigureName("!!!")).toBe("figure");
    expect(slugifyFigureName("")).toBe("figure");
    expect(slugifyFigureName("   ")).toBe("figure");
  });

  it("never leaves a dash after the 48 character cut", () => {
    const prompt = `${"a".repeat(47)} tail`;
    expect(slugifyFigureName(prompt)).toBe("a".repeat(47));

    const exact = `${"b".repeat(48)} tail`;
    expect(slugifyFigureName(exact)).toBe("b".repeat(48));
  });

  it("looks at no more than the first 200 characters", () => {
    const prompt = `${"c".repeat(200)}zzz`;
    expect(slugifyFigureName(prompt)).toBe("c".repeat(48));
  });
});

describe("bytesToBase64", () => {
  it("round trips every byte value", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const encoded = bytesToBase64(bytes);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("handles an input larger than one chunk", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(0xff);
    bytes[0] = 0x00;
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0]).toBe(0);
    expect(decoded.at(-1)).toBe(0xff);
  });

  it("returns an empty string for no bytes", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});
