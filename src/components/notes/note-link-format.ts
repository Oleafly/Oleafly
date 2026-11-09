import { backtickRunEnd, codeSpanEnd, type FencedLine, fencedLines } from "@/lib/code-fences";
import { frontMatterBody } from "@/lib/front-matter";

export type NoteLinkKind = "note" | "project";

export interface NoteLinkTarget {
  kind: NoteLinkKind;
  id: string;
  heading?: string;
}

export interface NoteHeading {
  level: number;
  text: string;
  slug: string;
}

export interface NoteLinkMention extends NoteLinkTarget {
  snippet: string;
}

export const SNIPPET_CHARS = 120;
const SNAP_CHARS = 20;
const MAX_ID_CHARS = 128;
const LINKABLE_ID = /^[A-Za-z0-9_-]+$/u;
const NOTE_LINK = /^oleafly:\/\/(note|project)\/([^/?#]+)\/?(?:#(.*))?$/iu;
const SLUG_DROP = /[^\p{L}\p{M}\p{N}_\- ]/gu;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const BLOCK_MARKER = /^(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)/u;

export function isLinkableId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length <= MAX_ID_CHARS && LINKABLE_ID.test(id);
}

export function noteLinkHref(kind: NoteLinkKind, id: string, heading?: string): string {
  const base = `oleafly://${kind}/${id}`;
  return heading ? `${base}#${encodeURIComponent(heading)}` : base;
}

function decodedFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function parseNoteLink(href: string | null | undefined): NoteLinkTarget | null {
  const match = NOTE_LINK.exec((href ?? "").trim());
  if (!match) return null;
  const id = match[2];
  if (!isLinkableId(id)) return null;
  const kind = match[1].toLowerCase() as NoteLinkKind;
  const heading = match[3] ? decodedFragment(match[3]) : "";
  return kind === "note" && heading ? { kind, id, heading } : { kind, id };
}

export function headingSlug(text: string): string {
  return text.trim().toLowerCase().replace(SLUG_DROP, "").replaceAll(" ", "-");
}

export function uniqueSlugs(texts: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = headingSlug(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  });
}

export function plainHeading(source: string): string {
  let text = source
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/`([^`]*)`/gu, "$1")
    .replace(/<[^>]+>/gu, "");
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replace(/(\*\*|__|\*|_|~~|==)(\S(?:.*?\S)?)\1/gu, "$2");
  }
  return text.replace(/\\(.)/gu, "$1").replace(/\s+/gu, " ").trim();
}

function headingLines(lines: readonly FencedLine[]): { level: number; text: string; line: number }[] {
  const found: { level: number; text: string; line: number }[] = [];
  lines.forEach((line, index) => {
    const heading = line.fenced ? null : ATX_HEADING.exec(line.text);
    if (heading) found.push({ level: heading[1].length, text: plainHeading(heading[2] ?? ""), line: index });
  });
  return found;
}

export function noteSection(markdown: string, slug: string): string | null {
  const lines = bodyLines(markdown);
  const found = headingLines(lines);
  const at = uniqueSlugs(found.map((heading) => heading.text)).indexOf(slug);
  if (at < 0) return null;
  const start = found[at];
  const next = found.slice(at + 1).find((heading) => heading.level <= start.level);
  return lines
    .slice(start.line, next ? next.line : lines.length)
    .map((line) => line.text)
    .join("\n")
    .trim();
}

export function noteHeadings(markdown: string): NoteHeading[] {
  const found = headingLines(bodyLines(markdown));
  const slugs = uniqueSlugs(found.map((heading) => heading.text));
  return found
    .map(({ level, text }, index) => ({ level, text, slug: slugs[index] }))
    .filter((heading) => heading.text !== "");
}

export function targetKey(target: NoteLinkTarget): string {
  return `${target.kind}:${target.id}`;
}

interface Piece {
  text: string;
  target: NoteLinkTarget | null;
}

interface ParsedLink {
  label: string;
  destination: string;
  end: number;
}

function plainFragment(chars: readonly string[]): string {
  let out = "";
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (char === "\\" && index + 1 < chars.length) {
      out += chars[++index];
    } else if (char === "~" && chars[index + 1] === "~") {
      index++;
    } else if (char !== "*" && char !== "`") {
      out += char === "|" ? " " : char;
    }
  }
  return out;
}

function closingBracket(chars: readonly string[], start: number): number {
  let depth = 0;
  for (let index = start; index < chars.length; index++) {
    const char = chars[index];
    if (char === "\\") index++;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return index;
  }
  return -1;
}

function skipSpaces(chars: readonly string[], start: number): number {
  let index = start;
  while (chars[index] === " " || chars[index] === "\t") index++;
  return index;
}

function destinationAt(chars: readonly string[], start: number): { destination: string; end: number } | null {
  if (chars[start] === "<") {
    let index = start + 1;
    while (index < chars.length && chars[index] !== ">" && chars[index] !== "<") index += chars[index] === "\\" ? 2 : 1;
    if (chars[index] !== ">") return null;
    return { destination: chars.slice(start + 1, index).join(""), end: index + 1 };
  }
  let index = start;
  let depth = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (char === " " || char === "\t") break;
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "(") depth++;
    if (char === ")") {
      if (depth === 0) break;
      depth--;
    }
    index++;
  }
  return { destination: chars.slice(start, Math.min(index, chars.length)).join(""), end: index };
}

function titleEnd(chars: readonly string[], start: number): number {
  const quote = chars[start];
  if (quote !== '"' && quote !== "'") return start;
  let index = start + 1;
  while (index < chars.length && chars[index] !== quote) index += chars[index] === "\\" ? 2 : 1;
  return index < chars.length ? index + 1 : -1;
}

function linkAt(chars: readonly string[], start: number): ParsedLink | null {
  const close = closingBracket(chars, start);
  if (close < 0 || chars[close + 1] !== "(") return null;
  const found = destinationAt(chars, skipSpaces(chars, close + 2));
  if (!found) return null;
  let index = skipSpaces(chars, found.end);
  index = titleEnd(chars, index);
  if (index < 0) return null;
  index = skipSpaces(chars, index);
  if (chars[index] !== ")") return null;
  return { label: plainFragment(chars.slice(start + 1, close)), destination: found.destination, end: index + 1 };
}

function autolinkAt(chars: readonly string[], start: number): { url: string; end: number } | null {
  let index = start + 1;
  while (index < chars.length && chars[index] !== ">") {
    if (chars[index] === "<" || chars[index] === " " || chars[index] === "\t") return null;
    index++;
  }
  if (index >= chars.length) return null;
  const url = chars.slice(start + 1, index).join("");
  return SCHEME.test(url) ? { url, end: index + 1 } : null;
}

function lineBody(line: string): string {
  let rest = line.trimStart();
  for (let match = BLOCK_MARKER.exec(rest); match; match = BLOCK_MARKER.exec(rest)) {
    rest = rest.slice(match[0].length).trimStart();
  }
  return rest;
}

function linePieces(line: string): Piece[] {
  const chars = Array.from(lineBody(line));
  const pieces: Piece[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 0) pieces.push({ text: plainFragment(run), target: null });
    run = [];
  };
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (char === "\\" && index + 1 < chars.length) {
      run.push(char, chars[index + 1]);
      index += 2;
      continue;
    }
    if (char === "`") {
      const open = backtickRunEnd(chars, index);
      const end = codeSpanEnd(chars, index);
      if (end === null) {
        run.push(...chars.slice(index, open));
        index = open;
        continue;
      }
      flush();
      pieces.push({ text: chars.slice(open, end - (open - index)).join(""), target: null });
      index = end;
      continue;
    }
    const image = char === "!" && chars[index + 1] === "[";
    if (char === "[" || image) {
      const link = linkAt(chars, image ? index + 1 : index);
      if (link) {
        flush();
        pieces.push({ text: link.label, target: parseNoteLink(link.destination) });
        index = link.end;
        continue;
      }
    }
    if (char === "<") {
      const auto = autolinkAt(chars, index);
      if (auto) {
        flush();
        pieces.push({ text: auto.url, target: parseNoteLink(auto.url) });
        index = auto.end;
        continue;
      }
    }
    run.push(char);
    index++;
  }
  flush();
  return pieces;
}

function collapsed(chars: readonly string[]): string[] {
  const out: string[] = [];
  for (const char of chars) {
    const space = /\s/u.test(char);
    if (space && (out.length === 0 || out.at(-1) === " ")) continue;
    out.push(space ? " " : char);
  }
  return out;
}

function snippetOf(pieces: readonly Piece[], at: number): string {
  const before = collapsed(Array.from(pieces.slice(0, at).map((piece) => piece.text).join("")));
  const link = Array.from(pieces[at].text.replace(/\s+/gu, " ").trim());
  const after = Array.from(pieces.slice(at + 1).map((piece) => piece.text).join(""));
  const chars = collapsed([...before, ...link, ...after]);
  while (chars.at(-1) === " ") chars.pop();
  if (chars.length <= SNIPPET_CHARS) return chars.join("");
  const linkStart = before.length;
  const linkEnd = linkStart + link.length;
  let start = Math.max(0, Math.min(linkStart - Math.floor((SNIPPET_CHARS - link.length) / 2), chars.length - SNIPPET_CHARS));
  if (link.length >= SNIPPET_CHARS) start = linkStart;
  let end = Math.min(chars.length, start + SNIPPET_CHARS);
  if (start > 0) {
    const space = chars.indexOf(" ", start);
    if (space >= 0 && space < start + SNAP_CHARS && space < linkStart) start = space + 1;
  }
  if (end < chars.length) {
    const space = chars.lastIndexOf(" ", end);
    if (space > end - SNAP_CHARS && space >= linkEnd) end = space;
  }
  const text = chars.slice(start, end).join("").trim();
  return `${start > 0 ? "…" : ""}${text}${end < chars.length ? "…" : ""}`;
}

function bodyLines(markdown: string): FencedLine[] {
  return fencedLines(frontMatterBody(markdown));
}

export function linkTargets(markdown: string): NoteLinkMention[] {
  const found = new Map<string, NoteLinkMention>();
  for (const line of bodyLines(markdown)) {
    if (line.fenced) continue;
    const pieces = linePieces(line.text);
    pieces.forEach((piece, index) => {
      if (!piece.target || found.has(targetKey(piece.target))) return;
      const { kind, id } = piece.target;
      found.set(targetKey(piece.target), { kind, id, snippet: snippetOf(pieces, index) });
    });
  }
  return [...found.values()];
}
