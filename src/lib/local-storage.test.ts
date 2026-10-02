import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJson, readString, removeKey, writeJson, writeString } from "./local-storage";

const KEY = "oleafly.test.local-storage";

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error("storage unavailable");
  };
  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
    clear: fail,
    key: fail,
    length: 0,
  } as unknown as Storage;
}

function withLocalStorage(descriptor: PropertyDescriptor, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, ...descriptor });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
  }
}

beforeEach(() => {
  localStorage.removeItem(KEY);
});

afterEach(() => {
  localStorage.removeItem(KEY);
});

describe("string helpers", () => {
  it("round-trips a value and removes it", () => {
    expect(readString(KEY)).toBeNull();
    writeString(KEY, "split");
    expect(readString(KEY)).toBe("split");
    removeKey(KEY);
    expect(readString(KEY)).toBeNull();
  });

  it("treats a missing localStorage as empty and ignores writes", () => {
    withLocalStorage({ value: undefined, writable: true }, () => {
      expect(readString(KEY)).toBeNull();
      expect(() => writeString(KEY, "x")).not.toThrow();
      expect(() => removeKey(KEY)).not.toThrow();
    });
  });

  it("swallows storage errors", () => {
    withLocalStorage({ value: throwingStorage(), writable: true }, () => {
      expect(readString(KEY)).toBeNull();
      expect(() => writeString(KEY, "x")).not.toThrow();
      expect(() => removeKey(KEY)).not.toThrow();
      expect(readJson(KEY, ["fallback"])).toEqual(["fallback"]);
      expect(() => writeJson(KEY, { a: 1 })).not.toThrow();
    });
  });

  it("survives a localStorage getter that throws", () => {
    const get = () => {
      throw new Error("SecurityError");
    };
    withLocalStorage({ get }, () => {
      expect(readString(KEY)).toBeNull();
      expect(() => writeString(KEY, "x")).not.toThrow();
    });
  });
});

describe("readJson", () => {
  it("returns the fallback for a missing, empty or malformed entry", () => {
    expect(readJson(KEY, [1])).toEqual([1]);
    localStorage.setItem(KEY, "");
    expect(readJson(KEY, [2])).toEqual([2]);
    localStorage.setItem(KEY, "{not json");
    expect(readJson(KEY, [3])).toEqual([3]);
  });

  it("returns the parsed value", () => {
    localStorage.setItem(KEY, JSON.stringify({ a: "b" }));
    expect(readJson<Record<string, string>>(KEY, {})).toEqual({ a: "b" });
  });

  it("runs the parser and falls back when it throws", () => {
    localStorage.setItem(KEY, JSON.stringify([1, "x", 2]));
    const numbers = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
    expect(readJson(KEY, [], numbers)).toEqual([1, 2]);
    localStorage.setItem(KEY, "null");
    expect(
      readJson(KEY, ["fallback"], (value) => Object.keys(value as object)),
    ).toEqual(["fallback"]);
  });
});

describe("writeJson", () => {
  it("stores the serialized value", () => {
    writeJson(KEY, ["a", "b"]);
    expect(localStorage.getItem(KEY)).toBe('["a","b"]');
  });

  it("skips values that cannot be serialized", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => writeJson(KEY, cyclic)).not.toThrow();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
