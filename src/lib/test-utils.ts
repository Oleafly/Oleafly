import { expect, vi } from "vitest";
import { MAX_UINT32 } from "./random";

export function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value == null) throw new Error("expected value");
  return value;
}

export function fixRandomFraction(fraction: 0 | 1): void {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof Uint32Array) array.fill(fraction === 1 ? MAX_UINT32 : 0);
    return array;
  });
}
