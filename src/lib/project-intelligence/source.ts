import type {
  ProjectIntelligenceEngine,
  SourceLocation,
  SourceRange,
} from "./types";

export const INDEXABLE_PROJECT_FILE =
  /\.(?:tex|ltx|latex|sty|cls|typ|md|markdown|bib)$/i;

export function engineForPath(
  path: string,
): ProjectIntelligenceEngine | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".bib")) return "bibtex";
  if (lower.endsWith(".typ")) return "typst";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "markdown";
  }
  if (/\.(?:tex|ltx|latex|sty|cls)$/i.test(lower)) return "latex";
  return null;
}

export function isProjectIntelligencePath(path: string): boolean {
  return INDEXABLE_PROJECT_FILE.test(path);
}

export function normalizeProjectPath(path: string): string | null {
  const replaced = path.replaceAll("\\", "/");
  const hasControlCharacter = [...replaced].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || codePoint === 0x7f)
    );
  });
  if (
    replaced.startsWith("/") ||
    /^[A-Za-z]:\//.test(replaced) ||
    hasControlCharacter
  ) {
    return null;
  }
  const parts: string[] = [];
  for (const part of replaced.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function resolveProjectPath(
  fromFile: string,
  rawTarget: string,
  defaultExtension?: string,
): string | null {
  const raw = rawTarget.trim().replace(/^["']|["']$/g, "");
  if (
    !raw ||
    raw.startsWith("#") ||
    raw.startsWith("@") ||
    raw.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(raw)
  ) {
    return null;
  }
  const joined = dirname(fromFile)
    ? `${dirname(fromFile)}/${raw.replace(/^\.\//, "")}`
    : raw.replace(/^\.\//, "");
  let normalized = normalizeProjectPath(joined);
  if (!normalized) return null;
  if (
    defaultExtension &&
    !/\.[a-z0-9]+$/i.test(normalized)
  ) {
    normalized += defaultExtension;
  }
  return normalized;
}

export function sourceHash(text: string): string {
  // A deterministic 32-bit FNV-1a hash is sufficient for cache invalidation;
  // sourceRevision remains the authoritative correctness identity.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function lineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function lineIndexAt(
  starts: readonly number[],
  offset: number,
): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function rangeFromOffsets(
  starts: readonly number[],
  from: number,
  to: number,
): SourceRange {
  const safeFrom = Math.max(0, from);
  const safeTo = Math.max(safeFrom, to);
  const startIndex = lineIndexAt(starts, safeFrom);
  const endIndex = lineIndexAt(starts, safeTo);
  return {
    from: safeFrom,
    to: safeTo,
    startLine: startIndex + 1,
    startColumn: safeFrom - starts[startIndex],
    endLine: endIndex + 1,
    endColumn: safeTo - starts[endIndex],
  };
}

export function location(
  file: string,
  starts: readonly number[],
  from: number,
  to: number,
): SourceLocation {
  return { file, range: rangeFromOffsets(starts, from, to) };
}

export function stableId(
  namespace: string,
  ...parts: readonly (string | number)[]
): string {
  return [namespace, ...parts.map(String)]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

export function maskLatexComments(text: string): string {
  const chars = text.split("");
  let comment = false;
  for (let index = 0; index < chars.length; index++) {
    if (comment) {
      if (chars[index] === "\n") comment = false;
      else chars[index] = " ";
      continue;
    }
    if (chars[index] !== "%") continue;
    let slashes = 0;
    for (
      let cursor = index - 1;
      cursor >= 0 && chars[cursor] === "\\";
      cursor--
    ) {
      slashes++;
    }
    if (slashes % 2 === 0) {
      chars[index] = " ";
      comment = true;
    }
  }
  return chars.join("");
}

export function maskTypstComments(text: string): string {
  const chars = text.split("");
  let blockDepth = 0;
  for (let index = 0; index < chars.length; index++) {
    if (blockDepth > 0) {
      if (text.startsWith("/*", index)) {
        chars[index] = " ";
        chars[index + 1] = " ";
        blockDepth++;
        index++;
      } else if (text.startsWith("*/", index)) {
        chars[index] = " ";
        chars[index + 1] = " ";
        blockDepth--;
        index++;
      } else if (chars[index] !== "\n") {
        chars[index] = " ";
      }
      continue;
    }
    if (text.startsWith("//", index)) {
      while (index < chars.length && chars[index] !== "\n") {
        chars[index] = " ";
        index++;
      }
      index--;
    } else if (text.startsWith("/*", index)) {
      chars[index] = " ";
      chars[index + 1] = " ";
      blockDepth = 1;
      index++;
    }
  }
  return chars.join("");
}

export function trimRange(
  text: string,
  from: number,
  to: number,
): readonly [number, number] {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}
