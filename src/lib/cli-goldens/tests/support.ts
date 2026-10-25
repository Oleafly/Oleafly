import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

// Golden fixtures for the Rust ports in crates/oleafly-preflight and
// crates/oleafly-lint. Inputs are written by hand; expected output is written
// only here, from the TypeScript code, with OLEAFLY_WRITE_GOLDENS=1. In a
// normal run these suites check that the committed goldens are current.

export const WRITE = process.env.OLEAFLY_WRITE_GOLDENS === "1";

// From the module's own path: the jsdom suites (pdf-facts) replace the global
// URL, which Node's fileURLToPath can't read.
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const PREFLIGHT_FIXTURES = path.join(REPO, "crates/oleafly-preflight/tests/fixtures");
export const LINT_FIXTURES = path.join(REPO, "crates/oleafly-lint/tests/fixtures");

const REGENERATE = "OLEAFLY_WRITE_GOLDENS=1 pnpm vitest run src/lib/cli-goldens";

export function byCodePoint(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

/** Drops `undefined`, sorts object keys by code point. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item === undefined ? null : item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort(byCodePoint)) {
      if (record[key] !== undefined) out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

export function canonicalPretty(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function expectGolden(file: string, value: unknown): void {
  const text = canonicalPretty(value);
  if (WRITE) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(`Run ${REGENERATE} to create ${path.relative(REPO, file)}`);
  }
  expect(fs.readFileSync(file, "utf8")).toBe(text);
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function readCases<T extends { name: string }>(file: string): T[] {
  return readJson<T[]>(file);
}

export function normalizeEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** The app's file tree: no `.git`, `.oleafly` or symlinks, depth < 64, names sorted per folder. */
export function walkProject(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth >= 64) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => byCodePoint(a.name, b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".oleafly" || entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else out.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root, 0);
  return out;
}

/** `[proseStart, sourceStart, length]` runs of a prose-to-source offset map. */
export function compressMap(map: readonly number[]): [number, number, number][] {
  const runs: [number, number, number][] = [];
  for (let index = 0; index < map.length; index++) {
    const last = runs.at(-1);
    if (last && last[0] + last[2] === index && last[1] + last[2] === map[index]) last[2]++;
    else runs.push([index, map[index], 1]);
  }
  return runs;
}

function withoutEmptyParams(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutEmptyParams);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      if (key === "params" && item && typeof item === "object" && Object.keys(item).length === 0) continue;
      out[key] = withoutEmptyParams(item);
    }
    return out;
  }
  return value;
}

/** A finding as `JSON.stringify` writes it, without empty message params. */
export function normalizeFinding<T>(finding: T): T {
  return withoutEmptyParams(JSON.parse(JSON.stringify(finding))) as T;
}

export function normalizeFindings<T>(findings: readonly T[]): T[] {
  return findings.map(normalizeFinding);
}
