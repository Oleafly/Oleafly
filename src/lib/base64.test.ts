import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, textToBase64 } from "./base64";

const PANGRAM = "Grüße, 世界 😀";

describe("bytesToBase64", () => {
  it("encodes every byte value", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes buffers larger than one chunk", () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 7 }, (_, index) => (index * 31) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("encodes an empty buffer as an empty string", () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe("");
  });
});

describe("textToBase64", () => {
  it("encodes text as UTF-8", () => {
    expect(textToBase64(PANGRAM)).toBe(Buffer.from(PANGRAM, "utf8").toString("base64"));
  });
});

describe("base64ToBytes", () => {
  it("round-trips bytes", () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, index) => (index * 7) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
  });
});
