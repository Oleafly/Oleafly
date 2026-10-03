import { invoke } from "@tauri-apps/api/core";

export interface LatexPackageEntry {
  name: string;
  caption: string;
  ctan: boolean;
  bundled: boolean;
  documentClass?: string;
}

export interface LatexPackageIndex {
  source: "ctan" | "bundled";
  fetchedAt: number | null;
  stale: boolean;
  packages: LatexPackageEntry[];
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export type LatexInstallMode = "on-demand" | "tlmgr" | "unknown";
export type LatexInstallState = "on-demand" | "installed" | "missing" | "unknown";

const REUSE_MS = 60 * 60_000;
const FALLBACK_RETRY_MS = 60_000;
const LOAD_LATE = new Set(["hyperref", "bookmark", "hypcap", "cleveref"]);

let cachedIndex: {
  promise: Promise<LatexPackageIndex>;
  offline: boolean;
  startedAt: number;
  fallbackAt: number | null;
} | null = null;

export function resetLatexPackageIndexCache(): void {
  cachedIndex = null;
}

export function loadLatexPackageIndex(options: {
  offline: boolean;
  refresh?: boolean;
}): Promise<LatexPackageIndex> {
  const refresh = options.refresh === true;
  const now = Date.now();
  const current = cachedIndex;
  const reusable =
    current !== null &&
    !refresh &&
    current.offline === options.offline &&
    now - current.startedAt < REUSE_MS &&
    (current.fallbackAt === null || now - current.fallbackAt < FALLBACK_RETRY_MS);
  if (reusable) return current.promise;
  const entry = {
    offline: options.offline,
    startedAt: now,
    fallbackAt: null as number | null,
    promise: invoke<LatexPackageIndex>("latex_package_index", { offline: options.offline, refresh }),
  };
  entry.promise.then(
    (index) => {
      if (index.source === "bundled" && !options.offline) entry.fallbackAt = Date.now();
    },
    () => {
      entry.fallbackAt = Date.now();
    },
  );
  cachedIndex = entry;
  return entry.promise;
}

function wordStartsWith(text: string, token: string): boolean {
  return text.split(/[^a-z0-9]+/).some((word) => word.startsWith(token));
}

function tokenScore(name: string, caption: string, token: string): number | null {
  if (name === token) return 0;
  if (name.startsWith(token)) return 1;
  if (name.includes(token)) return 2;
  if (wordStartsWith(caption, token)) return 3;
  if (caption.includes(token)) return 4;
  return null;
}

export function searchLatexPackages(
  packages: readonly LatexPackageEntry[],
  query: string,
): LatexPackageEntry[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { pkg: LatexPackageEntry; score: number }[] = [];
  for (const pkg of packages) {
    const name = pkg.name.toLowerCase();
    const caption = pkg.caption.toLowerCase();
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const rank = tokenScore(name, caption, token);
      if (rank === null) {
        matched = false;
        break;
      }
      score += rank;
    }
    if (matched) scored.push({ pkg, score });
  }
  scored.sort(
    (left, right) =>
      left.score - right.score ||
      Number(right.pkg.bundled) - Number(left.pkg.bundled) ||
      left.pkg.name.localeCompare(right.pkg.name),
  );
  return scored.map((entry) => entry.pkg);
}

export function usepackageLine(name: string, options: string): string {
  return options ? String.raw`\usepackage[${options}]{${name}}` : String.raw`\usepackage{${name}}`;
}

export function documentClassLine(name: string): string {
  return String.raw`\documentclass{${name}}`;
}

export function ctanUrl(name: string): string {
  return `https://ctan.org/pkg/${encodeURIComponent(name.toLowerCase())}`;
}

export function normalizePackageOptions(raw: string): string | null {
  const options = raw.trim().split(/\s+/).filter(Boolean).join(" ");
  let depth = 0;
  for (const character of options) {
    if (character === "%") return null;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0 || (depth === 0 && character === "]")) return null;
  }
  return depth === 0 ? options : null;
}

function maskComments(text: string): string {
  let masked = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      masked += text.slice(index, index + 2);
      index += 2;
    } else if (character === "%") {
      const end = text.indexOf("\n", index);
      const stop = end === -1 ? text.length : end;
      masked += " ".repeat(stop - index);
      index = stop;
    } else {
      masked += character;
      index += 1;
    }
  }
  return masked;
}

function skipSpace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function groupEnd(text: string, from: number, open: string, close: string): number | null {
  let depth = 0;
  let braces = 0;
  for (let index = from; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") {
      index += 1;
    } else if (open === "[" && character === "{") {
      braces += 1;
    } else if (open === "[" && character === "}") {
      braces -= 1;
    } else if (character === open && braces === 0) {
      depth += 1;
    } else if (character === close && braces === 0) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

interface PackageCommand {
  readonly names: string[];
  readonly from: number;
  readonly to: number;
}

function packageCommands(masked: string): PackageCommand[] {
  const commands: PackageCommand[] = [];
  const directive = /\\(?:usepackage|RequirePackage|RequirePackageWithOptions)(?![A-Za-z@])/g;
  for (let match = directive.exec(masked); match; match = directive.exec(masked)) {
    let cursor = skipSpace(masked, match.index + match[0].length);
    if (masked[cursor] === "[") {
      const optionsEnd = groupEnd(masked, cursor, "[", "]");
      if (optionsEnd === null) break;
      cursor = skipSpace(masked, optionsEnd);
    }
    if (masked[cursor] !== "{") continue;
    const namesEnd = groupEnd(masked, cursor, "{", "}");
    if (namesEnd === null) break;
    const names = masked
      .slice(cursor + 1, namesEnd - 1)
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean);
    commands.push({ names, from: match.index, to: namesEnd });
    directive.lastIndex = namesEnd;
  }
  return commands;
}

export function loadedPackageNames(texts: readonly string[]): Set<string> {
  const loaded = new Set<string>();
  for (const text of texts) {
    for (const command of packageCommands(maskComments(text))) {
      for (const name of command.names) loaded.add(name);
    }
  }
  return loaded;
}

function documentClassEnd(masked: string, limit: number): number | null {
  const match = /\\documentclass(?![A-Za-z@])/.exec(masked);
  if (!match || match.index >= limit) return null;
  let cursor = skipSpace(masked, match.index + match[0].length);
  if (masked[cursor] === "[") {
    const optionsEnd = groupEnd(masked, cursor, "[", "]");
    if (optionsEnd === null) return null;
    cursor = skipSpace(masked, optionsEnd);
  }
  if (masked[cursor] !== "{") return match.index + match[0].length;
  return groupEnd(masked, cursor, "{", "}");
}

function insertAfterLine(text: string, offset: number, line: string): TextEdit {
  const newline = text.indexOf("\n", offset);
  const at = newline === -1 ? text.length : newline;
  return { from: at, to: at, insert: `\n${line}` };
}

function insertBeforeLine(text: string, offset: number, line: string): TextEdit {
  const at = text.lastIndexOf("\n", offset - 1) + 1;
  return { from: at, to: at, insert: `${line}\n` };
}

export function usepackageEdit(
  text: string,
  name: string,
  options: string,
): TextEdit | "loaded" | "no-preamble" {
  const masked = maskComments(text);
  const wanted = name.toLowerCase();
  const commands = packageCommands(masked);
  if (commands.some((command) => command.names.includes(wanted))) return "loaded";
  const begin = /\\begin\s*\{document\}/.exec(masked);
  const limit = begin ? begin.index : text.length;
  const classEnd = documentClassEnd(masked, limit);
  const preamble = commands.filter(
    (command) => command.from < limit && (classEnd === null || command.from >= classEnd),
  );
  const line = usepackageLine(name, options);
  if (preamble.length > 0) {
    let last = preamble.length - 1;
    if (!LOAD_LATE.has(wanted)) {
      while (last >= 0 && preamble[last].names.every((loaded) => LOAD_LATE.has(loaded))) last -= 1;
    }
    if (last === preamble.length - 1) return insertAfterLine(text, preamble[last].to, line);
    return insertBeforeLine(text, preamble[last + 1].from, line);
  }
  if (classEnd !== null) return insertAfterLine(text, classEnd, line);
  if (begin) return insertBeforeLine(text, begin.index, line);
  return "no-preamble";
}

export function latexInstallMode(engineId: string, tlmgr: string | null | undefined): LatexInstallMode {
  if (engineId === "latex") return "on-demand";
  if (engineId === "latexmk" && tlmgr) return "tlmgr";
  return "unknown";
}

export function latexInstallState(
  entry: LatexPackageEntry,
  mode: LatexInstallMode,
  installed: ReadonlySet<string>,
  checked: boolean,
): LatexInstallState {
  if (mode === "on-demand") return "on-demand";
  if (mode !== "tlmgr" || !checked) return "unknown";
  if (installed.has(entry.name.toLowerCase())) return "installed";
  return entry.ctan ? "missing" : "unknown";
}
