import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const POLYFILL_IMPORT = /^import ["'](?:@\/lib\/polyfills|@oleafly\/preview\/polyfills|\.\/polyfills)["'];/u;

function workerEntries(directory: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) entries.push(...workerEntries(path));
    else if (/\.worker\.ts$/u.test(name)) entries.push(path);
  }
  return entries;
}

function firstStatement(source: string): string {
  return (
    source
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("//")) ?? ""
  );
}

describe("web worker entries", () => {
  it("load the runtime polyfills before anything else", () => {
    const entries = [...workerEntries(join(ROOT, "src")), ...workerEntries(join(ROOT, "packages"))];
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const missing = entries
      .filter((entry) => !POLYFILL_IMPORT.test(firstStatement(readFileSync(entry, "utf8"))))
      .map((entry) => relative(ROOT, entry));
    expect(missing).toEqual([]);
  });
});
