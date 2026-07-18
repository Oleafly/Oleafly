import { expect } from "vitest";

export function required<T>(value: T | null | undefined): T {
  expect(value).toBeDefined();
  if (value == null) throw new Error("expected value");
  return value;
}
