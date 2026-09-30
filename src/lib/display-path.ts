import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { markdownLines } from "@/lib/markdown-fences";
import { displayHomes } from "@/lib/tauri";

/**
 * Shows paths under the user's home folder as `~/…`, so a settings screen or a
 * screenshot does not print the account name. Every place the UI renders a
 * path from the backend goes through `displayPath` (one path) or `displayText`
 * (free text such as agent titles, logs and errors), which makes this module
 * the single switch for anything that later hides more (a screenshot mode).
 *
 * Display only: copy, reveal and every IPC call keep the raw path, because
 * neither Rust nor the file system expands `~`.
 *
 * `homeRelativePath` mirrors `project_availability::abbreviated_display_path`
 * in src-tauri, which the backend uses for linked folders and the CLI row.
 */

function isSeparator(char: string | undefined): boolean {
  return char === "/" || char === "\\";
}

const VERBATIM_UNC = "\\\\?\\UNC\\";
const VERBATIM = "\\\\?\\";

// `\\?\C:\x` becomes `C:\x` and `\\?\UNC\server\share` becomes `\\server\share`.
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

/** `path` with a leading home folder replaced by `~`; anything else unchanged. */
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
  return char.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const textPatterns = new Map<string, RegExp>();

function textPattern(home: string): RegExp | null {
  const cached = textPatterns.get(home);
  if (cached) return cached;
  // A home with no folder name ("/", "C:") would match every absolute path.
  if (!/[^\\/:]/.test(home) || /^[A-Za-z]:$/.test(home)) return null;
  const body = Array.from(home, escapeForPattern).join("");
  const before = String.raw`(^|[^${NAME_CHAR}.~\\/])`;
  const verbatim = String.raw`(?:\\\\\?\\)?`;
  // After the home folder comes a separator, the end, or a character that
  // cannot continue a folder name ("/Users/ada." at the end of a sentence).
  const after = String.raw`(?=[\\/]|$|[^${NAME_CHAR}.]|\.(?![${NAME_CHAR}.]))`;
  const flags = isWindowsPath(home) ? "giu" : "gu";
  const pattern = new RegExp(`${before}${verbatim}${body}${after}`, flags);
  textPatterns.set(home, pattern);
  return pattern;
}

/** Free `text` with every path that starts at the home folder shortened to `~`. */
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
 * expand in a shell. Fences come from the scanner the plan reader also uses
 * (markdown-fences.ts), so both agree on which lines are code. A fence that
 * is still open (a reply that is streaming) runs to the end.
 */
export function outsideCodeFences(markdown: string, format: (prose: string) => string): string {
  let out = "";
  let prose = "";
  for (const line of markdownLines(markdown)) {
    if (line.fence === null) {
      prose += line.text + line.eol;
      continue;
    }
    if (prose) out += format(prose);
    prose = "";
    out += line.text + line.eol;
  }
  return prose ? out + format(prose) : out;
}

let homes: readonly string[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Records the spellings of the home folder the backend builds paths from. The
 * longest goes first, so a canonical home that contains the plain one wins.
 */
export function setDisplayHomes(next: readonly string[]): void {
  const unique = new Set<string>();
  for (const home of next) {
    const root = normalizedHome(home);
    if (root) unique.add(root);
  }
  homes = [...unique].sort((a, b) => b.length - a.length);
  loaded = true;
  notify();
}

/** Forgets the loaded home folders (tests start from a clean slate). */
export function resetDisplayHomes(): void {
  homes = [];
  loaded = false;
  loading = null;
  notify();
}

function insideDesktopApp(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

/**
 * Asks the backend once for the home folder. A failed or empty answer is not
 * remembered, so the next caller asks again.
 */
export function loadDisplayHomes(): Promise<void> {
  if (loaded || !insideDesktopApp()) return Promise.resolve();
  if (loading) return loading;
  // Starting from a resolved promise turns a synchronous throw (no IPC
  // bridge) into a failed answer instead of an exception in the caller.
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

/** A path from the backend, ready to show. */
export function displayPath(path: string): string {
  return pathFor(homes, path);
}

/** Free text from the backend or an agent, ready to show. */
export function displayText(text: string): string {
  return textFor(homes, text);
}

/** A run of display text, marked when screenshot mode should blur it. */
export interface PersonalPart {
  readonly text: string;
  readonly personal: boolean;
}

// A path runs until whitespace, a quote, a backtick or a shell bracket. Spaces
// inside a path end the match, which only leaves the tail of the path clear.
const PATH_CHAR = String.raw`[^\s"'\x60<>|]`;
const SEGMENT_CHAR = String.raw`[^\s\\/"'\x60<>|]`;
// Capture groups, not lookbehind: older WebKit builds reject lookbehind.
const PATH_START = String.raw`(^|[^${NAME_CHAR}.~\\/:])`;
const HOME_PATH = String.raw`~(?=[\\/]|$|[^${NAME_CHAR}.~]|\.(?![${NAME_CHAR}]))(?:[\\/]${PATH_CHAR}*)?`;
const DRIVE_PATH = String.raw`[A-Za-z]:[\\/]+${SEGMENT_CHAR}${PATH_CHAR}*`;
const UNC_PATH = String.raw`\\\\${SEGMENT_CHAR}+[\\/]+${PATH_CHAR}+`;
// Two segments at least, so a chat slash command ("/compact") stays clear.
const POSIX_PATH = `/${SEGMENT_CHAR}+/${PATH_CHAR}*`;
const PATH_PATTERN = new RegExp(
  `${PATH_START}(${HOME_PATH}|${DRIVE_PATH}|${UNC_PATH}|${POSIX_PATH})`,
  "gu",
);
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/u;
const EMAIL_PATTERN = new RegExp(
  String.raw`(^|[^${NAME_CHAR}.+])([${NAME_CHAR}.+]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)+)`,
  "gu",
);

function escapeLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function accountNames(current: readonly string[]): Array<{ name: string; windows: boolean }> {
  const seen = new Map<string, boolean>();
  for (const home of current) {
    const segments = home.split(/[\\/]+/).filter(Boolean);
    const name = segments.at(-1);
    // A home right under the root ("/root") names a system account, and a
    // name shorter than three letters would blur ordinary words.
    if (!name || segments.length < 2 || name.length < 3 || name.endsWith(":")) continue;
    seen.set(name, isWindowsPath(home));
  }
  return [...seen].map(([name, windows]) => ({ name, windows }));
}

type Range = [number, number];

function collect(pattern: RegExp, text: string, ranges: Range[], trim = false): void {
  for (const match of text.matchAll(pattern)) {
    const lead = match[1]?.length ?? 0;
    const body = trim ? match[2].replace(TRAILING_PUNCTUATION, "") : match[2];
    if (!body) continue;
    const start = match.index + lead;
    ranges.push([start, start + body.length]);
  }
}

function wordPattern(value: string, flags: string): RegExp {
  return new RegExp(String.raw`(^|[^\p{L}\p{N}_])(${escapeLiteral(value)})(?![\p{L}\p{N}_])`, flags);
}

const namePatterns = new Map<readonly string[], RegExp[]>();

// One pattern per account name, built once per set of homes: a raw log runs
// every line through here.
function accountPatterns(current: readonly string[]): RegExp[] {
  const cached = namePatterns.get(current);
  if (cached) return cached;
  const patterns = accountNames(current).map(({ name, windows }) =>
    wordPattern(name, windows ? "giu" : "gu"),
  );
  namePatterns.clear();
  namePatterns.set(current, patterns);
  return patterns;
}

function partsFor(current: readonly string[], text: string, values: readonly string[]): PersonalPart[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const ranges: Range[] = [];
  collect(PATH_PATTERN, text, ranges, true);
  collect(EMAIL_PATTERN, text, ranges);
  for (const pattern of accountPatterns(current)) collect(pattern, text, ranges);
  for (const value of values) {
    if (value.trim()) collect(wordPattern(value, "gu"), text, ranges);
  }
  if (ranges.length === 0) return [{ text, personal: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: PersonalPart[] = [];
  let cursor = 0;
  let open: Range | null = null;
  const close = () => {
    if (!open) return;
    if (open[0] > cursor) parts.push({ text: text.slice(cursor, open[0]), personal: false });
    parts.push({ text: text.slice(open[0], open[1]), personal: true });
    cursor = open[1];
    open = null;
  };
  for (const range of ranges) {
    if (open && range[0] <= open[1]) {
      open[1] = Math.max(open[1], range[1]);
      continue;
    }
    close();
    open = [range[0], range[1]];
  }
  close();
  if (cursor < text.length) parts.push({ text: text.slice(cursor), personal: false });
  return parts;
}

/**
 * Splits display text into the runs screenshot mode blurs and the runs it
 * leaves clear. Personal runs are home and absolute paths (as `displayText`
 * leaves them, so `~/…` too), email addresses, the account name from the home
 * folder, and any `values` the caller names (a size or a count in a sentence).
 */
export function personalParts(text: string, values: readonly string[] = []): PersonalPart[] {
  return partsFor(homes, text, values);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly string[] {
  return homes;
}

function useDisplayHomes(): readonly string[] {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void loadDisplayHomes();
  }, []);
  return current;
}

/** `displayPath` for components: re-renders once the home folder is known. */
export function useDisplayPath(): (path: string) => string {
  const current = useDisplayHomes();
  return useCallback((path: string) => pathFor(current, path), [current]);
}

/** `displayText` for components: re-renders once the home folder is known. */
export function useDisplayText(): (text: string) => string {
  const current = useDisplayHomes();
  return useCallback((text: string) => textFor(current, text), [current]);
}

/** `personalParts` for components: re-renders once the home folder is known. */
export function usePersonalParts(): (text: string, values?: readonly string[]) => PersonalPart[] {
  const current = useDisplayHomes();
  return useCallback(
    (text: string, values: readonly string[] = []) => partsFor(current, text, values),
    [current],
  );
}
