import { describe, expect, it } from "vitest";
import { pngWithDpi } from "./png";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...[...type].map((character) => character.codePointAt(0) ?? 0),
    ...data,
    0,
    0,
    0,
    0,
  ];
}

const toBase64 = (bytes: number[]) => btoa(String.fromCodePoint(...bytes));
const fromBase64 = (base64: string) => Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

function chunks(bytes: number[]): { type: string; data: number[] }[] {
  const out: { type: string; data: number[] }[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    out.push({
      type: String.fromCodePoint(...bytes.slice(at + 4, at + 8)),
      data: bytes.slice(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return out;
}

const IHDR = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const IEND = chunk("IEND", []);

describe("pngWithDpi", () => {
  it("puts one pHYs chunk with the resolution right after the header and drops the old one", () => {
    const png = toBase64([...SIGNATURE, ...IHDR, ...chunk("pHYs", [0, 0, 0, 1, 0, 0, 0, 1, 0]), ...IEND]);
    const read = chunks(fromBase64(pngWithDpi(png, 192)));
    expect(read.map((item) => item.type)).toEqual(["IHDR", "pHYs", "IEND"]);
    expect(read[1].data).toEqual([0, 0, 0x1d, 0x87, 0, 0, 0x1d, 0x87, 1]);
  });

  it("returns anything that is not a whole PNG unchanged", () => {
    const notPng = toBase64([...SIGNATURE.slice(0, 7), 0, ...IHDR, ...IEND]);
    expect(pngWithDpi(notPng, 192)).toBe(notPng);
    const truncated = toBase64([...SIGNATURE, 0, 0, 0xff, 13, ...IHDR.slice(4), ...IEND]);
    expect(pngWithDpi(truncated, 192)).toBe(truncated);
    const headless = toBase64([...SIGNATURE, ...chunk("tEXt", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...IEND]);
    expect(pngWithDpi(headless, 192)).toBe(headless);
  });
});
