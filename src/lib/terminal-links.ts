import { safePdfExternalUrl } from "@oleafly/preview/controller";
import { compilePathResolver } from "@/lib/compile-file-path";

export type TerminalLinkMatch =
  | { kind: "file"; start: number; end: number; path: string; line?: number; column?: number }
  | { kind: "url"; start: number; end: number; url: string };

const MAX_LINE = 10_000_000;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"`]+/gi;
const PYTHON_FRAME = /File "([^"\n]{1,4096})", line (\d{1,8})/g;
const TOKEN = /\S+/g;
// The path ends at the first line number followed by a colon or the end, so
// grep, git grep and rg results (`file:3:\section{Intro}`) keep the matched
// text out of it. Bounded digit runs keep this linear even though it is tried
// at every colon.
const LOCATION = /:(\d{1,8})(?::(\d{1,8}))?(?=:|$)/;
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
const MAX_PATH_WORDS = 12;
const ABSOLUTE = /^(?:[/\\~]|[a-z]:[/\\]|file:)/i;
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
  const location = LOCATION.exec(text);
  if (!location) {
    return looksLikePath(text) ? { kind: "file", start, end: start + text.length, path: text } : null;
  }
  const path = text.slice(0, location.index);
  const line = Number(location[1]);
  if (!looksLikePath(path) || !validLine(line)) return null;
  const column = location[2] === undefined ? 0 : Number(location[2]);
  const end = start + location.index + location[0].length;
  return { kind: "file", start, end, path, line, ...(column >= 1 ? { column } : {}) };
}

function tokenMatch(token: string, offset: number): TerminalLinkMatch | null {
  let from = 0;
  let to = token.length;
  while (from < to && TOKEN_OPENERS.includes(token[from])) from += 1;
  while (to > from && TOKEN_CLOSERS.includes(token[to - 1])) to -= 1;
  return fileMatch(token.slice(from, to), offset + from);
}

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

const RESOLVER_OPTIONS = { implicitTex: false, longerPaths: false };

export function terminalPathResolver(
  files: readonly string[],
): (path: string) => string | null {
  const resolve = compilePathResolver(files, RESOLVER_OPTIONS);
  return (path) => {
    if (isAbsoluteTerminalPath(path) || OUTSIDE_PROJECT.test(path)) return null;
    const relative = path.replace(LEADING_RELATIVE, "");
    const found = resolve(relative);
    const namesake = found !== null && SEPARATOR.test(found) && !SEPARATOR.test(relative);
    return namesake && PARENT.test(path) ? null : found;
  };
}

export function safeTerminalUrl(text: string): string | null {
  const url = safePdfExternalUrl(text);
  if (!url) return null;
  const { protocol } = new URL(url);
  return protocol === "http:" || protocol === "https:" ? url : null;
}
