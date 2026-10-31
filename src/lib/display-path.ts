import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { scanFences } from "@/lib/code-fences";
import { isSeparator } from "@/lib/path-utils";
import { escapeRegExp } from "@/lib/regexp";
import { createEmitter } from "@/lib/emitter";
import { displayHomes } from "@/lib/tauri";

/**
 * Shows paths under the user's home folder as `~/…`, so a settings screen or a
 * screenshot does not print the account name. Every place the UI renders a
 * path from the backend goes through `displayPath` (one path) or `displayText`
 * (free text such as agent titles, logs and errors), which makes this module
 * the single switch for anything that hides more (Settings blurs its paths).
 *
 * Display only: copy, reveal and every IPC call keep the raw path, because
 * neither Rust nor the file system expands `~`.
 *
 * `homeRelativePath` mirrors `project_availability::abbreviated_display_path`
 * in src-tauri, which the backend uses for linked folders and the CLI row.
 */

const VERBATIM_UNC = "\\\\?\\UNC\\";
const VERBATIM = "\\\\?\\";

function withoutVerbatimPrefix(path: string): string {
  if (path.startsWith(VERBATIM_UNC)) return `\\\\${path.slice(VERBATIM_UNC.length)}`;
  if (path.startsWith(VERBATIM)) return path.slice(VERBATIM.length);
  return path;
}

function trimTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 1 && isSeparator(path[end - 1])) end -= 1;
  return path.slice(0, end);
}

// Windows paths compare without regard to case or slash direction; POSIX paths
// compare exactly, as Rust's `Path::strip_prefix` does.
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:(?:[\\/]|$)/.test(path) || path.startsWith("\\\\");
}

function normalizedHome(home: string | null | undefined): string | null {
  if (typeof home !== "string" || home.length === 0) return null;
  const plain = trimTrailingSeparators(withoutVerbatimPrefix(home));
  return plain.length > 0 ? plain : null;
}

function samePrefix(path: string, home: string, windows: boolean): boolean {
  const head = path.slice(0, home.length);
  if (!windows) return head === home;
  const fold = (value: string) => value.replaceAll("/", "\\").toLowerCase();
  return fold(head) === fold(home);
}

export function homeRelativePath(path: string, home: string | null | undefined): string {
  const shown = withoutVerbatimPrefix(path);
  const root = normalizedHome(home);
  if (!root) return shown;
  const windows = isWindowsPath(root);
  if (!samePrefix(shown, root, windows)) return shown;
  const rest = shown.slice(root.length);
  if (rest.length === 0) return "~";
  if (!isSeparator(rest[0])) return shown;
  return trimTrailingSeparators(rest).length <= 1 ? "~" : `~${trimTrailingSeparators(rest)}`;
}

const NAME_CHAR = String.raw`\p{L}\p{N}_\-`;

// One or more of either slash: logs on Windows write `C:/Users/…` and Rust's
// `{path:?}` writes `C:\\Users\\…`.
function escapeForPattern(char: string): string {
  if (isSeparator(char)) return String.raw`[\\/]+`;
  return escapeRegExp(char);
}

const textPatterns = new Map<string, RegExp>();

function textPattern(home: string): RegExp | null {
  const cached = textPatterns.get(home);
  if (cached) return cached;
  if (!/[^\\/:]/.test(home) || /^[A-Za-z]:$/.test(home)) return null;
  const body = Array.from(home, escapeForPattern).join("");
  const before = String.raw`(^|[^${NAME_CHAR}.~\\/])`;
  const verbatim = String.raw`(?:\\\\\?\\)?`;
  const after = String.raw`(?=[\\/]|$|[^${NAME_CHAR}.]|\.(?![${NAME_CHAR}.]))`;
  const flags = isWindowsPath(home) ? "giu" : "gu";
  const pattern = new RegExp(`${before}${verbatim}${body}${after}`, flags);
  textPatterns.set(home, pattern);
  return pattern;
}

export function homeRelativeText(text: string, home: string | null | undefined): string {
  const root = normalizedHome(home);
  if (!root || !text) return text;
  const pattern = textPattern(root);
  return pattern ? text.replace(pattern, "$1~") : text;
}

/**
 * `markdown` with `format` applied to everything except fenced code blocks.
 * Chat replies show home paths as `~`, but a code block keeps the real path:
 * its Copy code button copies what is shown, and a `~` inside quotes does not
 * expand in a shell. A fence that is still open (a reply that is streaming)
 * runs to the end.
 */
export function outsideCodeFences(markdown: string, format: (prose: string) => string): string {
  let out = "";
  let from = 0;
  for (const fence of scanFences(markdown)) {
    out += format(markdown.slice(from, fence.from)) + markdown.slice(fence.from, fence.to);
    from = fence.to;
  }
  return out + format(markdown.slice(from));
}

let homes: readonly string[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const homesChanged = createEmitter();

export function setDisplayHomes(next: readonly string[]): void {
  const unique = new Set<string>();
  for (const home of next) {
    const root = normalizedHome(home);
    if (root) unique.add(root);
  }
  homes = [...unique].sort((a, b) => b.length - a.length);
  loaded = true;
  homesChanged.emit();
}

export function resetDisplayHomes(): void {
  homes = [];
  loaded = false;
  loading = null;
  homesChanged.emit();
}

function insideDesktopApp(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

export function loadDisplayHomes(): Promise<void> {
  if (loaded || !insideDesktopApp()) return Promise.resolve();
  if (loading) return loading;
  const request: Promise<void> = Promise.resolve()
    .then(() => displayHomes())
    .then(
      (value) => {
        if (loading !== request) return;
        loading = null;
        if (Array.isArray(value)) {
          setDisplayHomes(value.filter((home): home is string => typeof home === "string"));
        }
      },
      () => {
        if (loading === request) loading = null;
      },
    );
  loading = request;
  return request;
}

function pathFor(current: readonly string[], path: string): string {
  if (typeof path !== "string" || path.length === 0) return path;
  for (const home of current) {
    const shown = homeRelativePath(path, home);
    if (shown.startsWith("~")) return shown;
  }
  return withoutVerbatimPrefix(path);
}

function textFor(current: readonly string[], text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  return current.reduce((out, home) => homeRelativeText(out, home), text);
}

export type DisplayTextRange = readonly [from: number, to: number];

function rangesFor(current: readonly string[], text: string): DisplayTextRange[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const ranges: DisplayTextRange[] = [];
  for (const home of current) {
    const pattern = textPattern(home);
    if (!pattern) continue;
    for (const match of text.matchAll(pattern)) {
      const from = match.index + match[1].length;
      const to = match.index + match[0].length;
      if (ranges.every(([start, end]) => to <= start || from >= end)) ranges.push([from, to]);
    }
  }
  return ranges.sort((left, right) => left[0] - right[0]);
}

export function displayTextRanges(text: string): DisplayTextRange[] {
  return rangesFor(homes, text);
}

export function displayPath(path: string): string {
  return pathFor(homes, path);
}

export function displayText(text: string): string {
  return textFor(homes, text);
}

export interface PathPart {
  readonly text: string;
  readonly path: boolean;
}

const PATH_CHAR = String.raw`[^\s"'\x60<>|]`;
const SEGMENT_CHAR = String.raw`[^\s\\/"'\x60<>|]`;
// Capture groups, not lookbehind: older WebKit builds reject lookbehind.
const PATH_START = String.raw`(^|[^${NAME_CHAR}.~\\/:])`;
const HOME_PATH = String.raw`~(?=[\\/]|$|[^${NAME_CHAR}.~]|\.(?![${NAME_CHAR}]))(?:[\\/]${PATH_CHAR}*)?`;
const DRIVE_PATH = String.raw`[A-Za-z]:[\\/]+${SEGMENT_CHAR}${PATH_CHAR}*`;
const UNC_PATH = String.raw`\\\\${SEGMENT_CHAR}+[\\/]+${PATH_CHAR}+`;
const POSIX_PATH = `/${SEGMENT_CHAR}+/${PATH_CHAR}*`;
const PATH_PATTERN = new RegExp(
  `${PATH_START}(${HOME_PATH}|${DRIVE_PATH}|${UNC_PATH}|${POSIX_PATH})`,
  "gu",
);
const TRAILING_PUNCTUATION = new Set(".,;:!?)]}");

function withoutTrailingPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(value.charAt(end - 1))) end -= 1;
  return value.slice(0, end);
}

export function pathParts(text: string): PathPart[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const parts: PathPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(PATH_PATTERN)) {
    const path = withoutTrailingPunctuation(match[2]);
    if (!path) continue;
    const start = match.index + (match[1]?.length ?? 0);
    if (start > cursor) parts.push({ text: text.slice(cursor, start), path: false });
    parts.push({ text: path, path: true });
    cursor = start + path.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), path: false });
  return parts;
}

function snapshot(): readonly string[] {
  return homes;
}

function useDisplayHomes(): readonly string[] {
  const current = useSyncExternalStore(homesChanged.subscribe, snapshot, snapshot);
  useEffect(() => {
    void loadDisplayHomes();
  }, []);
  return current;
}

export function useDisplayPath(): (path: string) => string {
  const current = useDisplayHomes();
  return useCallback((path: string) => pathFor(current, path), [current]);
}

export function useDisplayText(): (text: string) => string {
  const current = useDisplayHomes();
  return useCallback((text: string) => textFor(current, text), [current]);
}

export function useDisplayTextRanges(): (text: string) => DisplayTextRange[] {
  const current = useDisplayHomes();
  return useCallback((text: string) => rangesFor(current, text), [current]);
}
