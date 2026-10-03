import { invoke } from "@tauri-apps/api/core";
import type { ProjectMeta } from "@oleafly/backend-port";

export interface UniversePackage {
  name: string;
  version: string;
  versions: string[];
  description: string;
  authors: string[];
  license: string | null;
  keywords: string[];
  categories: string[];
  disciplines: string[];
  compiler: string | null;
  template: boolean;
  updatedAt: number | null;
  homepage: string | null;
}

export interface TypstUniverseIndex {
  fetchedAt: number;
  stale: boolean;
  packages: UniversePackage[];
}

export interface TypstPackageSettings {
  vendorPackages: boolean;
  vendored: string[];
}

export interface TypstVendorReport {
  vendored: string[];
  unchanged: string[];
  missing: string[];
}

export interface TypstVendorResult {
  report: TypstVendorReport;
  project: ProjectMeta;
}

export const typstPackageSettings = (projectId: string) =>
  invoke<TypstPackageSettings>("typst_package_settings", { projectId });

export const setTypstVendorPackages = (projectId: string, enabled: boolean) =>
  invoke<ProjectMeta>("set_typst_vendor_packages", { projectId, enabled });

export const vendorTypstPackages = (projectId: string, offline: boolean) =>
  invoke<TypstVendorResult>("vendor_typst_packages", { projectId, offline });

const FAILURE_RETRY_MS = 60_000;
const REUSE_MS = 60 * 60_000;

let cachedIndex: {
  promise: Promise<TypstUniverseIndex>;
  offline: boolean;
  startedAt: number;
  failedAt: number | null;
} | null = null;

export function resetUniverseIndexCache(): void {
  cachedIndex = null;
}

export function loadUniverseIndex(options: {
  offline: boolean;
  refresh?: boolean;
}): Promise<TypstUniverseIndex> {
  const refresh = options.refresh === true;
  const now = Date.now();
  const reusable =
    cachedIndex !== null &&
    !refresh &&
    cachedIndex.offline === options.offline &&
    now - cachedIndex.startedAt < REUSE_MS &&
    (cachedIndex.failedAt === null || now - cachedIndex.failedAt < FAILURE_RETRY_MS);
  if (reusable && cachedIndex) return cachedIndex.promise;
  const entry = {
    offline: options.offline,
    startedAt: now,
    failedAt: null as number | null,
    promise: invoke<TypstUniverseIndex>("typst_universe_index", {
      offline: options.offline,
      refresh,
    }),
  };
  entry.promise.catch(() => {
    entry.failedAt = Date.now();
  });
  cachedIndex = entry;
  return entry.promise;
}

function versionParts(version: string): number[] | null {
  const parts = version.trim().split(".");
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map(Number);
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) {
    if (a) return 1;
    if (b) return -1;
    return left.localeCompare(right);
  }
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function compilerTooNew(pkg: UniversePackage, typstVersion: string | null | undefined): boolean {
  if (!pkg.compiler || !typstVersion) return false;
  return compareVersions(pkg.compiler, typstVersion) > 0;
}

function tokenScore(pkg: UniversePackage, token: string): number | null {
  const name = pkg.name.toLowerCase();
  if (name === token) return 0;
  if (name.startsWith(token)) return 1;
  if (name.includes(token)) return 2;
  const keywords = pkg.keywords.map((keyword) => keyword.toLowerCase());
  if (keywords.includes(token)) return 3;
  if (keywords.some((keyword) => keyword.includes(token))) return 4;
  if (pkg.categories.some((category) => category.toLowerCase().includes(token))) return 5;
  if (pkg.disciplines.some((discipline) => discipline.toLowerCase().includes(token))) return 5;
  if (pkg.description.toLowerCase().includes(token)) return 6;
  return null;
}

export function searchPackages(
  packages: readonly UniversePackage[],
  query: string,
  category: string | null,
): UniversePackage[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { pkg: UniversePackage; score: number }[] = [];
  for (const pkg of packages) {
    if (category && !pkg.categories.includes(category)) continue;
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const tokenRank = tokenScore(pkg, token);
      if (tokenRank === null) {
        matched = false;
        break;
      }
      score += tokenRank;
    }
    if (matched) scored.push({ pkg, score });
  }
  return scored
    .sort((left, right) => left.score - right.score || left.pkg.name.localeCompare(right.pkg.name))
    .map((entry) => entry.pkg);
}

export function packageCategories(packages: readonly UniversePackage[]): string[] {
  return [...new Set(packages.flatMap((pkg) => pkg.categories))].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function importLine(name: string, version: string): string {
  return `#import "@preview/${name}:${version}": *`;
}

interface StringLiteral {
  readonly value: string;
  readonly from: number;
}

function stringLiterals(text: string): StringLiteral[] {
  const literals: StringLiteral[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    const next = text[index + 1];
    if (character === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end + 1;
    } else if (character === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else if (character === '"') {
      const from = index + 1;
      let value = "";
      index = from;
      while (index < text.length && text[index] !== '"' && text[index] !== "\n") {
        if (text[index] === "\\") {
          value += text[index + 1] ?? "";
          index += 2;
        } else {
          value += text[index];
          index += 1;
        }
      }
      literals.push({ value, from });
      index += 1;
    } else {
      index += 1;
    }
  }
  return literals;
}

const PREVIEW_SPEC = /^@preview\/([a-z0-9][a-z0-9_-]*):(\d+\.\d+\.\d+)$/;

export interface PreviewImport {
  name: string;
  version: string;
  from: number;
  to: number;
}

export function previewImports(text: string): PreviewImport[] {
  const imports: PreviewImport[] = [];
  for (const literal of stringLiterals(text)) {
    const match = PREVIEW_SPEC.exec(literal.value);
    if (!match) continue;
    const from = literal.from + literal.value.length - match[2].length;
    imports.push({ name: match[1], version: match[2], from, to: from + match[2].length });
  }
  return imports;
}

export interface OutdatedImport extends PreviewImport {
  latest: string;
}

export function outdatedImports(
  text: string,
  latest: ReadonlyMap<string, string>,
): OutdatedImport[] {
  return previewImports(text).flatMap((found) => {
    const newest = latest.get(found.name);
    return newest && compareVersions(newest, found.version) > 0 ? [{ ...found, latest: newest }] : [];
  });
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

function leadingImportEnd(text: string): number | null {
  let offset = 0;
  let lastImportEnd: number | null = null;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(offset, lineEnd).trim();
    if (line.startsWith("#import")) {
      lastImportEnd = newline === -1 ? text.length : newline + 1;
    } else if (line !== "" && !line.startsWith("//")) {
      break;
    }
    if (newline === -1) break;
    offset = newline + 1;
  }
  return lastImportEnd;
}

export function importEdit(text: string, name: string, version: string): TextEdit | null {
  const existing = previewImports(text).find((found) => found.name === name);
  if (existing) {
    return existing.version === version
      ? null
      : { from: existing.from, to: existing.to, insert: version };
  }
  const line = importLine(name, version);
  const end = leadingImportEnd(text);
  if (end === null) return { from: 0, to: 0, insert: `${line}\n` };
  if (end === text.length && !text.endsWith("\n")) {
    return { from: end, to: end, insert: `\n${line}` };
  }
  return { from: end, to: end, insert: `${line}\n` };
}
