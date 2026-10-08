import { describe, expect, it, vi } from "vitest";
import {
  installArrayBufferTransfer,
  installArrayChangeByCopy,
  installIteratorHelpers,
  installMathSumPrecise,
  installPromiseWithResolvers,
  installRegExpEscape,
  installSetMethods,
  installUint8ArrayBase64,
} from "./polyfills";

type Sum = (items: Iterable<unknown>) => number;

function sumPrecise(): Sum {
  const math: { sumPrecise?: Sum } = {};
  installMathSumPrecise(math);
  return math.sumPrecise as Sum;
}

function helpers() {
  const prototype = Object.create(null) as Record<string, (...args: never[]) => unknown>;
  installIteratorHelpers(prototype);
  return prototype;
}

function iteratorOf(values: number[], prototype: object) {
  let position = 0;
  const iterator = Object.create(prototype) as Iterator<number> & { closed: number; [Symbol.iterator](): Iterator<number> };
  iterator.closed = 0;
  iterator.next = () =>
    position < values.length ? { done: false, value: values[position++] } : { done: true, value: undefined };
  iterator.return = () => {
    iterator.closed += 1;
    return { done: true, value: undefined };
  };
  iterator[Symbol.iterator] = () => iterator;
  return iterator;
}

describe("Math.sumPrecise", () => {
  it("adds floating point values exactly before rounding once", () => {
    const sum = sumPrecise();
    expect(sum([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sum([1e20, 0.1, -1e20])).toBe(0.1);
    expect(sum([4, 8, 12])).toBe(24);
    expect(sum(new Set([1, 2, 3]))).toBe(6);
  });

  it("follows the special cases of the standard", () => {
    const sum = sumPrecise();
    expect(Object.is(sum([]), -0)).toBe(true);
    expect(Object.is(sum([-0, -0]), -0)).toBe(true);
    expect(Object.is(sum([-0, 0]), 0)).toBe(true);
    expect(sum([Number.POSITIVE_INFINITY, 1])).toBe(Number.POSITIVE_INFINITY);
    expect(sum([Number.NEGATIVE_INFINITY, 1])).toBe(Number.NEGATIVE_INFINITY);
    expect(sum([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toBeNaN();
    expect(sum([1, Number.NaN])).toBeNaN();
    expect(sum([1e308, 1e308, -1e308])).toBe(1e308);
    expect(sum([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Number.POSITIVE_INFINITY);
    expect(() => sum([1, "2"])).toThrow(TypeError);
  });

  it("keeps an engine's own implementation", () => {
    const native = () => 0;
    const math = { sumPrecise: native };
    installMathSumPrecise(math);
    expect(math.sumPrecise).toBe(native);
  });
});

describe("Promise.withResolvers", () => {
  it("returns a promise with its resolve and reject functions", async () => {
    const ctor = class extends Promise<unknown> {} as unknown as PromiseConstructor & { withResolvers?: unknown };
    Reflect.deleteProperty(ctor, "withResolvers");
    installPromiseWithResolvers(ctor);
    const withResolvers = (ctor as unknown as { withResolvers: <T>() => { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } }).withResolvers;
    const resolved = withResolvers.call(ctor);
    resolved.resolve(4);
    await expect(resolved.promise).resolves.toBe(4);
    const rejected = withResolvers.call(ctor);
    rejected.reject(new Error("no"));
    await expect(rejected.promise).rejects.toThrow("no");
  });
});

describe("Uint8Array base64", () => {
  function base64() {
    const ctor = function () {} as unknown as Function & { prototype: object; fromBase64?: (input: unknown, options?: object) => Uint8Array };
    installUint8ArrayBase64(ctor);
    const toBase64 = (ctor.prototype as { toBase64: (this: Uint8Array, options?: object) => string }).toBase64;
    return { encode: (bytes: Uint8Array, options?: object) => toBase64.call(bytes, options), decode: ctor.fromBase64 as (input: unknown, options?: object) => Uint8Array };
  }

  it("round trips bytes in both alphabets", () => {
    const { encode, decode } = base64();
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(encode(bytes)).toBe("AAEC+vv8/f7/");
    expect(encode(bytes, { alphabet: "base64url" })).toBe("AAEC-vv8_f7_");
    expect(encode(new Uint8Array([104, 105]), { omitPadding: true })).toBe("aGk");
    expect([...decode("AAEC+vv8/f7/")]).toEqual([...bytes]);
    expect([...decode("AAEC-vv8_f7_", { alphabet: "base64url" })]).toEqual([...bytes]);
    expect([...decode("aGk")]).toEqual([104, 105]);
    expect([...decode(" aG k=\n")]).toEqual([104, 105]);
  });

  it("encodes large arrays and rejects invalid text", () => {
    const { encode, decode } = base64();
    const large = new Uint8Array(100_000).map((_, index) => index % 256);
    expect([...decode(encode(large))]).toEqual([...large]);
    expect(() => decode("a-b")).toThrow(SyntaxError);
    expect(() => decode("ab+/", { alphabet: "base64url" })).toThrow(SyntaxError);
    expect(() => decode("@@@@")).toThrow(SyntaxError);
    expect(() => decode(42)).toThrow(TypeError);
  });
});

describe("iterator helpers", () => {
  it("maps, filters, takes and drops lazily", () => {
    const prototype = helpers();
    const source = iteratorOf([1, 2, 3, 4, 5, 6], prototype);
    const mapper = vi.fn((value: number) => value * 10);
    const mapped = prototype.map.call(source, mapper as never) as Iterator<number>;
    expect(mapper).not.toHaveBeenCalled();
    expect(mapped.next()).toEqual({ done: false, value: 10 });
    expect([...(prototype.filter.call(iteratorOf([1, 2, 3, 4], prototype), ((value: number) => value % 2 === 0) as never) as Iterable<number>)]).toEqual([2, 4]);
    const taken = iteratorOf([1, 2, 3, 4], prototype);
    expect([...(prototype.take.call(taken, 2 as never) as Iterable<number>)]).toEqual([1, 2]);
    expect(taken.closed).toBe(1);
    expect([...(prototype.drop.call(iteratorOf([1, 2, 3, 4], prototype), 3 as never) as Iterable<number>)]).toEqual([4]);
    expect([...(prototype.flatMap.call(iteratorOf([1, 2], prototype), ((value: number) => [value, value]) as never) as Iterable<number>)]).toEqual([1, 1, 2, 2]);
    expect(() => prototype.take.call(iteratorOf([], prototype), -1 as never)).toThrow(RangeError);
    expect(() => prototype.filter.call(iteratorOf([], prototype), "x" as never)).toThrow(TypeError);
  });

  it("stops early and closes the source for some and every", () => {
    const prototype = helpers();
    const some = iteratorOf([1, 2, 3], prototype);
    expect(prototype.some.call(some, ((value: number) => value === 2) as never)).toBe(true);
    expect(some.closed).toBe(1);
    const every = iteratorOf([1, 2, 3], prototype);
    expect(prototype.every.call(every, ((value: number) => value < 2) as never)).toBe(false);
    expect(every.closed).toBe(1);
    expect(prototype.some.call(iteratorOf([1], prototype), (() => false) as never)).toBe(false);
  });

  it("collects, visits and reduces", () => {
    const prototype = helpers();
    expect(prototype.toArray.call(iteratorOf([3, 4], prototype))).toEqual([3, 4]);
    const seen: number[] = [];
    prototype.forEach.call(iteratorOf([5, 6], prototype), ((value: number) => seen.push(value)) as never);
    expect(seen).toEqual([5, 6]);
    expect(prototype.reduce.call(iteratorOf([1, 2, 3], prototype), ((total: number, value: number) => total + value) as never)).toBe(6);
    expect(prototype.reduce.call(iteratorOf([], prototype), ((total: number) => total) as never, 7 as never)).toBe(7);
    expect(() => prototype.reduce.call(iteratorOf([], prototype), ((total: number) => total) as never)).toThrow(TypeError);
    expect(() => prototype.map.call(iteratorOf([1], prototype), "x" as never)).toThrow(TypeError);
  });
});

describe("Set methods", () => {
  it("combine and compare sets", () => {
    const prototype = Object.create(Set.prototype) as object;
    for (const key of ["union", "intersection", "difference", "symmetricDifference", "isSubsetOf", "isSupersetOf", "isDisjointFrom"]) {
      Object.defineProperty(prototype, key, { value: undefined, writable: true, configurable: true });
    }
    installSetMethods({ prototype });
    const set = (values: number[]) => Object.setPrototypeOf(new Set(values), prototype) as Set<number> & Record<string, (other: Set<number>) => unknown>;
    const left = set([1, 2, 3]);
    const right = new Set([2, 3, 4]);
    expect([...(left.union(right) as Set<number>)]).toEqual([1, 2, 3, 4]);
    expect([...(left.intersection(right) as Set<number>)]).toEqual([2, 3]);
    expect([...(left.difference(right) as Set<number>)]).toEqual([1]);
    expect([...(left.symmetricDifference(right) as Set<number>)]).toEqual([1, 4]);
    expect(set([2]).isSubsetOf(right)).toBe(true);
    expect(left.isSupersetOf(new Set([1, 2]))).toBe(true);
    expect(set([9]).isDisjointFrom(right)).toBe(true);
  });
});

describe("ArrayBuffer transfer", () => {
  it("moves the bytes into a buffer of the requested length", () => {
    const prototype = Object.create(ArrayBuffer.prototype) as object;
    for (const key of ["transfer", "transferToFixedLength"]) {
      Object.defineProperty(prototype, key, { value: undefined, writable: true, configurable: true });
    }
    installArrayBufferTransfer({ prototype });
    const transfer = (prototype as { transferToFixedLength: (this: ArrayBuffer, length?: number) => ArrayBuffer }).transferToFixedLength;
    const source = new Uint8Array([1, 2, 3, 4]).buffer;
    const shorter = transfer.call(source, 2);
    expect([...new Uint8Array(shorter)]).toEqual([1, 2]);
    expect(source.byteLength).toBe(0);
    const longer = transfer.call(new Uint8Array([5, 6]).buffer, 4);
    expect([...new Uint8Array(longer)]).toEqual([5, 6, 0, 0]);
    expect(transfer.call(new Uint8Array([7]).buffer).byteLength).toBe(1);
  });
});

describe("RegExp.escape", () => {
  it("escapes text so it matches itself literally", () => {
    const ctor: { escape?: (input: unknown) => string } = {};
    installRegExpEscape(ctor);
    const escape = ctor.escape as (input: unknown) => string;
    expect(escape("1a.b*c")).toBe("\\x31a\\.b\\*c");
    expect(escape("a, b-c")).toBe("\\x61\\x2c\\x20b\\x2dc");
    expect(escape("line\nbreak\t")).toBe("\\x6cine\\nbreak\\t");
    for (const text of ["(x+y)^2 = $z", "path/to/[file].tex", "über café", "a|b?{c}"]) {
      expect(new RegExp(`^${escape(text)}$`, "u").test(text)).toBe(true);
    }
    expect(() => escape(1)).toThrow(TypeError);
  });
});

describe("Array change by copy", () => {
  it("returns changed copies and leaves the original alone", () => {
    const prototype = Object.create(Array.prototype) as object;
    for (const key of ["toReversed", "toSorted", "toSpliced", "with"]) {
      Object.defineProperty(prototype, key, { value: undefined, writable: true, configurable: true });
    }
    installArrayChangeByCopy({ prototype });
    const list = Object.setPrototypeOf([3, 1, 2], prototype) as number[] & Record<string, (...args: never[]) => number[]>;
    expect(list.toReversed()).toEqual([2, 1, 3]);
    expect(list.toSorted()).toEqual([1, 2, 3]);
    expect(list.toSpliced(1 as never, 1 as never, 9 as never)).toEqual([3, 9, 2]);
    expect(list.with(-1 as never, 7 as never)).toEqual([3, 1, 7]);
    expect([...list]).toEqual([3, 1, 2]);
    expect(() => list.with(5 as never, 0 as never)).toThrow(RangeError);
  });
});
