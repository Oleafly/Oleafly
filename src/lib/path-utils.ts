export function isSeparator(char: string | undefined): boolean {
  return char === "/" || char === "\\";
}

const VERBATIM_UNC = "\\\\?\\UNC\\";
const VERBATIM = "\\\\?\\";

/** Windows' `\\?\` form, which `canonicalize` returns, in its everyday spelling. */
export function withoutVerbatimPrefix(path: string): string {
  if (path.startsWith(VERBATIM_UNC)) return `\\\\${path.slice(VERBATIM_UNC.length)}`;
  if (path.startsWith(VERBATIM)) return path.slice(VERBATIM.length);
  return path;
}

function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

export function basename(path: string): string {
  return path.slice(lastSeparator(path) + 1);
}

export function dirname(path: string): string {
  const index = lastSeparator(path);
  return index < 0 ? "" : path.slice(0, index);
}

export const UNSAFE_FILE_NAME_CHARACTERS = /[^\p{L}\p{M}\p{N}_.-]+/gu;

const FILE_STEM_EDGE = new Set(["_", "."]);

export function exportFileStem(name: string | null | undefined, fallback: string): string {
  const stem = (name ?? "").replace(UNSAFE_FILE_NAME_CHARACTERS, "_");
  let start = 0;
  let end = stem.length;
  while (start < end && FILE_STEM_EDGE.has(stem[start])) start += 1;
  while (end > start && FILE_STEM_EDGE.has(stem[end - 1])) end -= 1;
  return stem.slice(start, end) || fallback;
}

export function relativeFilePath(fromFile: string, target: string): string {
  const base = dirname(fromFile).split("/").filter(Boolean);
  const parts = target.split("/").filter(Boolean);
  let shared = 0;
  while (shared < base.length && shared < parts.length - 1 && base[shared] === parts[shared]) shared++;
  return [...base.slice(shared).map(() => ".."), ...parts.slice(shared)].join("/");
}
