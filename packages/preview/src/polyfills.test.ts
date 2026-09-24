import { describe, expect, it, vi } from "vitest";
import {
  installGetOrInsert,
  installIteratorFind,
  installPromiseTry,
  installUint8ArrayToHex,
  installURLParse,
} from "./polyfills";

function mapBackedPrototype() {
  const store = new Map<unknown, unknown>();
  const prototype: Record<string, unknown> = {
    has: (key: unknown) => store.has(key),
    get: (key: unknown) => store.get(key),
    set: (key: unknown, value: unknown) => store.set(key, value),
  };
  return { prototype, store };
}

function trackedIterator(values: number[], prototype: object) {
  let position = 0;
  const iterator = Object.create(prototype) as Iterator<number> & { closed: number };
  iterator.closed = 0;
  iterator.next = () =>
    position < values.length
      ? { done: false, value: values[position++] }
      : { done: true, value: undefined };
  iterator.return = () => {
    iterator.closed += 1;
    return { done: true, value: undefined };
  };
  return iterator;
}

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

  it("installs non-enumerable Map upsert methods that insert only missing keys", () => {
    const { prototype, store } = mapBackedPrototype();
    installGetOrInsert({ prototype });
    const getOrInsert = prototype.getOrInsert as (key: unknown, value: unknown) => unknown;
    const getOrInsertComputed = prototype.getOrInsertComputed as (
      key: unknown,
      callback: (key: unknown) => unknown,
    ) => unknown;

    expect(Object.getOwnPropertyDescriptor(prototype, "getOrInsert")?.enumerable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(prototype, "getOrInsertComputed")?.enumerable).toBe(false);
    expect(getOrInsert.call(prototype, "page", 1)).toBe(1);
    expect(getOrInsert.call(prototype, "page", 2)).toBe(1);
    const compute = vi.fn((key: unknown) => [key]);
    const listeners = getOrInsertComputed.call(prototype, "textlayerrendered", compute);
    expect(getOrInsertComputed.call(prototype, "textlayerrendered", compute)).toBe(listeners);
    expect(compute).toHaveBeenCalledOnce();
    expect(compute).toHaveBeenCalledWith("textlayerrendered");
    expect([...store]).toEqual([
      ["page", 1],
      ["textlayerrendered", ["textlayerrendered"]],
    ]);
  });

  it("preserves native Map upsert methods", () => {
    const native = () => "native";
    const prototype = { getOrInsert: native, getOrInsertComputed: native };
    installGetOrInsert({ prototype });
    expect(prototype.getOrInsert).toBe(native);
    expect(prototype.getOrInsertComputed).toBe(native);
  });

  it("installs Iterator.prototype.find that stops and closes on the first match", () => {
    const prototype: { find?: unknown } = {};
    installIteratorFind(prototype);
    const find = prototype.find as (
      this: Iterator<number>,
      predicate: (value: number, index: number) => unknown,
    ) => number | undefined;
    expect(Object.getOwnPropertyDescriptor(prototype, "find")?.enumerable).toBe(false);

    const seen: [number, number][] = [];
    const matching = trackedIterator([4, 7, 9], prototype);
    expect(
      find.call(matching, (value, index) => {
        seen.push([value, index]);
        return value > 5;
      }),
    ).toBe(7);
    expect(seen).toEqual([
      [4, 0],
      [7, 1],
    ]);
    expect(matching.closed).toBe(1);

    const exhausted = trackedIterator([1, 2], prototype);
    expect(find.call(exhausted, () => false)).toBeUndefined();
    expect(exhausted.closed).toBe(0);
  });

  it("closes the iterator when the find predicate throws or is not callable", () => {
    const prototype: { find?: unknown } = {};
    installIteratorFind(prototype);
    const find = prototype.find as (this: Iterator<number>, predicate: unknown) => unknown;

    const throwing = trackedIterator([1, 2], prototype);
    expect(() =>
      find.call(throwing, () => {
        throw new Error("predicate failed");
      }),
    ).toThrow("predicate failed");
    expect(throwing.closed).toBe(1);

    const uncallable = trackedIterator([1], prototype);
    expect(() => find.call(uncallable, "not a function")).toThrow(TypeError);
    expect(uncallable.closed).toBe(1);
  });

  it("preserves a native Iterator.prototype.find", () => {
    const native = () => "native";
    const prototype = { find: native };
    installIteratorFind(prototype);
    expect(prototype.find).toBe(native);
  });
});
