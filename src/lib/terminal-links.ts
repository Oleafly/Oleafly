import { safePdfExternalUrl } from "@oleafly/preview/controller";
import { compilePathResolver } from "@/lib/compile-file-path";

/**
 * A link found in one line of terminal text. Offsets are UTF-16 indices into
 * that text, `end` exclusive, so callers map them back to cells themselves.
 */
export type TerminalLinkMatch =
  | { kind: "file"; start: number; end: number; path: string; line?: number; column?: number }
  | { kind: "url"; start: number; end: number; url: string };

const MAX_LINE = 10_000_000;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"`]+/gi;
const PYTHON_FRAME = /File "([^"\n]{1,4096})", line (\d{1,8})/g;
const TOKEN = /\S+/g;
// Bounded digit runs keep this linear even though it is tried at every colon.
const LINE_SUFFIX = /:(\d{1,8})(?::(\d{1,8}))?$/;
const EXTENSION = /\.[A-Za-z][A-Za-z0-9]*$/;
// Where a tool starts its location line, the path may hold spaces: Typst's
// `┌─ file:l:c` and pdflatex -file-line-error's `./file:l:`. Group 1 is the
// whole `path:line[:col]`.
const LOCATION_LINES = [
  /^\s*┌─\s+(\S.*?:\d{1,8}:\d{1,8})\s*$/d,
  /^(\.{1,2}[\\/][^:]*:\d{1,8}(?::\d{1,8})?)(?=[:\s]|$)/d,
];
// Tectonic's `error: file:l:` can hold a spaced path, but other tools put
// prose there (ruff's `error: Failed to parse src/main.py:3:5:`), so the text
// after each space is only a candidate until it names a project file.
const MESSAGE_LINE = /^(?:error|warning):\s+([^:\s][^:]*:\d{1,8}(?::\d{1,8})?)(?=[:\s]|$)/d;
const WORD_START = /(?<!\S)\S/g;
// Bounds the resolver calls per hovered line; no file name has this many words.
const MAX_PATH_WORDS = 12;
const ABSOLUTE = /^(?:[/\\~]|[A-Za-z]:[/\\]|file:)/i;
// Typst packages (`@preview/...`) and shell or Windows variables live outside
// the project just as absolute paths do.
const OUTSIDE_PROJECT = /^[@$%]/;
const LEADING_RELATIVE = /^(?:\.{1,2}[/\\])+/;
const PARENT = /^(?:\.{1,2}[/\\])*\.\.[/\\]/;
const SEPARATOR = /[/\\]/;
const TOKEN_OPENERS = "([{<'\"";
const TOKEN_CLOSERS = ")]}>'\",;:.!?";
const URL_TRAILERS = ".,;:!?'\"";
const URL_PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function count(text: string, char: string): number {
  let total = 0;
  for (const c of text) if (c === char) total += 1;
  return total;
}

// Sentence punctuation and a wrapping bracket end up glued to URLs in prose;
// a closing bracket stays only while the URL itself opened one.
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    const open = URL_PAIRS[last];
    const body = url.slice(0, end);
    if (URL_TRAILERS.includes(last) || (open && count(body, open) < count(body, last))) {
      end -= 1;
    } else {
      break;
    }
  }
  return url.slice(0, end);
}

function looksLikePath(path: string): boolean {
  if (!path || path.startsWith("-")) return false;
  return path.includes("/") || path.includes("\\") || EXTENSION.test(path);
}

function validLine(value: number): boolean {
  return value >= 1 && value <= MAX_LINE;
}

function fileMatch(text: string, start: number): TerminalLinkMatch | null {
  if (!text || text.startsWith("-") || text.includes("://")) return null;
  const end = start + text.length;
  const suffix = LINE_SUFFIX.exec(text);
  if (!suffix) return looksLikePath(text) ? { kind: "file", start, end, path: text } : null;
  const path = text.slice(0, suffix.index);
  const line = Number(suffix[1]);
  if (!looksLikePath(path) || !validLine(line)) return null;
  const column = suffix[2] === undefined ? 0 : Number(suffix[2]);
  return { kind: "file", start, end, path, line, ...(column >= 1 ? { column } : {}) };
}

function tokenMatch(token: string, offset: number): TerminalLinkMatch | null {
  let from = 0;
  let to = token.length;
  while (from < to && TOKEN_OPENERS.includes(token[from])) from += 1;
  while (to > from && TOKEN_CLOSERS.includes(token[to - 1])) to -= 1;
  return fileMatch(token.slice(from, to), offset + from);
}

// The longest candidate wins, so `My Chapter.tex` beats `Chapter.tex` when
// both exist. With none accepted, the token pass links the words as usual.
function messageLocation(
  text: string,
  accept: (path: string) => boolean,
): TerminalLinkMatch | null {
  const match = MESSAGE_LINE.exec(text);
  const span = match?.indices?.[1];
  if (!match || !span) return null;
  const location = match[1];
  const starts = [...location.matchAll(WORD_START)].slice(-MAX_PATH_WORDS);
  for (const { index } of starts) {
    const candidate = fileMatch(location.slice(index), span[0] + index);
    if (candidate?.kind === "file" && accept(candidate.path)) return candidate;
  }
  return null;
}

/**
 * Finds file locations and web URLs in plain terminal text: `path:line[:col]`
 * (pdflatex, Tectonic, Typst, gcc), Python traceback frames, bare paths with a
 * slash or an extension, and http(s) URLs. It only reads the text; whether a
 * path names a project file is the resolver's call. `accept` settles the one
 * case the text cannot: whether the words before a path on an `error:` line
 * are part of it.
 */
export function findTerminalLinks(
  text: string,
  accept: (path: string) => boolean = () => true,
): TerminalLinkMatch[] {
  const found: TerminalLinkMatch[] = [];
  const add = (match: TerminalLinkMatch | null) => {
    if (!match) return;
    if (found.some((other) => match.start < other.end && other.start < match.end)) return;
    found.push(match);
  };

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = trimUrl(match[0]);
    if (!/^https?:\/\/[^/]/i.test(url)) continue;
    add({ kind: "url", start: match.index, end: match.index + url.length, url });
  }
  for (const match of text.matchAll(PYTHON_FRAME)) {
    const line = Number(match[2]);
    if (!validLine(line)) continue;
    const start = match.index + 'File "'.length;
    add({ kind: "file", start, end: start + match[1].length, path: match[1], line });
  }
  // Before the whitespace tokens, so a spaced path wins over its last piece.
  for (const pattern of LOCATION_LINES) {
    const match = pattern.exec(text);
    const span = match?.indices?.[1];
    if (match && span) add(fileMatch(match[1], span[0]));
  }
  add(messageLocation(text, accept));
  for (const match of text.matchAll(TOKEN)) add(tokenMatch(match[0], match.index));

  return found.sort((a, b) => a.start - b.start);
}

export function isAbsoluteTerminalPath(path: string): boolean {
  return ABSOLUTE.test(path);
}

/**
 * Maps a relative terminal path onto one project file: an exact match, a
 * unique file ending in it, or a unique basename, after leading `./` and
 * `../`. Absolute paths, packages and variables get no answer, and neither do
 * unknown leading folders: the webview does not know the project root, so it
 * cannot tell this project's `main.tex` from `other-project/main.tex`.
 * `../name` gets only a root file of that exact name, never a namesake in a
 * folder: from the project root it lies outside the project.
 */
export function terminalPathResolver(
  files: readonly string[],
): (path: string) => string | null {
  const resolve = compilePathResolver(files, { implicitTex: false, longerPaths: false });
  return (path) => {
    if (isAbsoluteTerminalPath(path) || OUTSIDE_PROJECT.test(path)) return null;
    const relative = path.replace(LEADING_RELATIVE, "");
    const found = resolve(relative);
    // With no folder in `relative`, only an exact match has none in `found`.
    const namesake = found !== null && SEPARATOR.test(found) && !SEPARATOR.test(relative);
    return namesake && PARENT.test(path) ? null : found;
  };
}

/** Terminal output is untrusted: only plain web links leave the app. */
export function safeTerminalUrl(text: string): string | null {
  const url = safePdfExternalUrl(text);
  if (!url) return null;
  const { protocol } = new URL(url);
  return protocol === "http:" || protocol === "https:" ? url : null;
}
