import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, vi } from "vitest";

const SOURCE_FILE = /\.(ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.(ts|tsx)$/;

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

function sourceFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFilesIn(path);
    return SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
  });
}

export function sourceFilesUnder(root: string, directories: readonly string[]): string[] {
  return directories.flatMap((directory) => sourceFilesIn(join(root, directory)));
}
