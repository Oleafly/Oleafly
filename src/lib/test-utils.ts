import { expect, vi } from "vitest";

export function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value == null) throw new Error("expected value");
  return value;
}

export function fixRandomFraction(fraction: 0 | 1): void {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    if (array instanceof BigUint64Array) array.fill(fraction === 1 ? 2n ** 64n - 1n : 0n);
    return array;
  });
}
