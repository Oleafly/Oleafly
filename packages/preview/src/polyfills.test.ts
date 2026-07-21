import { describe, expect, it } from "vitest";
import { installPromiseTry, installUint8ArrayToHex, installURLParse } from "./polyfills";

describe("PDF runtime polyfills", () => {
  it("installs a non-enumerable Uint8Array hexadecimal encoder", () => {
    const prototype: { toHex?: unknown } = {};
    installUint8ArrayToHex({ prototype });

    const descriptor = Object.getOwnPropertyDescriptor(prototype, "toHex");
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.configurable).toBe(true);
    expect(
      (descriptor?.value as (this: Uint8Array) => string).call(
        Uint8Array.from([0, 1, 15, 16, 254, 255]),
      ),
    ).toBe("00010f10feff");
  });

  it("preserves an existing native encoder", () => {
    const native = () => "native";
    const prototype = { toHex: native };
    installUint8ArrayToHex({ prototype });
    expect(prototype.toHex).toBe(native);
  });

  it("installs Promise.try with synchronous error and promise adoption semantics", async () => {
    const ctor: { try?: unknown } = {};
    installPromiseTry(ctor);
    const promiseTry = ctor.try as (
      callback: (...args: number[]) => number | Promise<number>,
      ...args: number[]
    ) => Promise<number>;

    await expect(promiseTry((left, right) => left + right, 2, 3)).resolves.toBe(5);
    await expect(promiseTry(async (value) => value * 2, 4)).resolves.toBe(8);
    await expect(
      promiseTry(() => {
        throw new Error("dispatch failed");
      }),
    ).rejects.toThrow("dispatch failed");
  });

  it("installs URL.parse with nullable parsing semantics", () => {
    const ctor = function TestURL(input: string | URL, base?: string | URL) {
      return new URL(input, base);
    } as unknown as {
      new (input: string | URL, base?: string | URL): URL;
      parse?: unknown;
    };
    installURLParse(ctor);
    const parse = ctor.parse as (input: string, base?: string) => URL | null;

    expect(parse("/document.pdf", "https://oleafly.com")?.href).toBe(
      "https://oleafly.com/document.pdf",
    );
    expect(parse("not a URL without a base")).toBeNull();
  });
});
