import { describe, expect, it } from "vitest";
import { installUint8ArrayToHex } from "./polyfills";

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
});
