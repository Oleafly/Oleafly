import { withoutBlockId } from "@oleafly/wysiwyg/block-id-marker";
import { stripTags } from "@/lib/citation/text";
import { type FencedLine, fencedLines } from "@/lib/code-fences";
import { frontMatterBody } from "@/lib/front-matter";
import { blockOfFragment } from "./note-block-ids";

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

const MAX_ID_CHARS = 128;
const LINKABLE_ID = /^[A-Za-z0-9_-]+$/u;
const NOTE_LINK = /^oleafly:\/\/(note|project)\/([^/?#]+)\/?(?:#(.*))?$/iu;
const SLUG_DROP = /[^\p{L}\p{M}\p{N}_\- ]/gu;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/u;

export function isLinkableId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.length <= MAX_ID_CHARS && LINKABLE_ID.test(id);
}

export function noteLinkHref(kind: NoteLinkKind, id: string, heading?: string): string {
  const base = `oleafly://${kind}/${id}`;
  if (blockOfFragment(heading)) return `${base}#${heading}`;
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
  return text.trim().toLowerCase().replaceAll(SLUG_DROP, "").replaceAll(" ", "-");
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

function withLinksAsLabels(source: string, opener: "[" | "!["): string {
  let out = "";
  let from = 0;
  let at = source.indexOf(opener);
  while (at >= 0) {
    const close = source.indexOf("]", at + opener.length);
    if (close < 0) break;
    if (source[close + 1] === "(") {
      const end = source.indexOf(")", close + 2);
      if (end < 0) break;
      out += source.slice(from, at) + source.slice(at + opener.length, close);
      from = end + 1;
    }
    at = source.indexOf(opener, Math.max(from, close + 1));
  }
  return out + source.slice(from);
}

export function plainHeading(source: string): string {
  let text = stripTags(withLinksAsLabels(withLinksAsLabels(source, "!["), "[").replaceAll(/`([^`]*)`/gu, "$1"));
  for (let previous = ""; previous !== text; ) {
    previous = text;
    text = text.replaceAll(/(\*\*|__|\*|_|~~|==)(\S(?:.*?\S)?)\1/gu, "$2");
  }
  return text.replaceAll(/\\(.)/gu, "$1").replaceAll(/\s+/gu, " ").trim();
}

export function isSpaceOrTab(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

export function scanToCharOrLineBreak(text: string, from: number, wanted: string): number {
  let at = from;
  while (at < text.length && text[at] !== wanted && text[at] !== "\n") at += 1;
  return at;
}

function headingTextEnd(line: string, start: number): number {
  let end = line.length;
  while (end > start && isSpaceOrTab(line[end - 1])) end -= 1;
  let marks = end;
  while (marks > start && line[marks - 1] === "#") marks -= 1;
  let gap = marks;
  while (gap > start && isSpaceOrTab(line[gap - 1])) gap -= 1;
  return marks < end && gap < marks ? gap : end;
}

function atxHeading(line: string): { level: number; text: string } | null {
  if (LINE_TERMINATOR.test(line)) return null;
  let at = 0;
  while (at < 3 && line[at] === " ") at += 1;
  const indent = at;
  while (line[at] === "#") at += 1;
  const level = at - indent;
  if (level < 1 || level > 6 || (at < line.length && !isSpaceOrTab(line[at]))) return null;
  while (isSpaceOrTab(line[at])) at += 1;
  return { level, text: line.slice(at, headingTextEnd(line, at)) };
}

function headingLines(lines: readonly FencedLine[]): { level: number; text: string; line: number }[] {
  const found: { level: number; text: string; line: number }[] = [];
  lines.forEach((line, index) => {
    const heading = line.fenced ? null : atxHeading(line.text);
    if (heading) found.push({ level: heading.level, text: plainHeading(withoutBlockId(heading.text)), line: index });
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

function bodyLines(markdown: string): FencedLine[] {
  return fencedLines(frontMatterBody(markdown));
}
