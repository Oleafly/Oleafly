import { scanMathExpressions } from "./math-source";
import {
  EMAIL_ADDRESS_PATTERN,
  spellingWordRanges,
  type SpellingWord,
} from "./spelling-words";

export interface MarkdownRange {
  from: number;
  to: number;
  word: string;
}

const TRAILING_PUNCT = new Set([".", ",", ":", "!", "?", ")", "]", "}", "'"]);

const PANDOC_ATTRIBUTES = String.raw`\{[ \t]*(?:[#.=][^{}\n]*|-[ \t]*|[\p{L}\p{N}_:-]+[ \t]*=[^{}\n]*)\}`;
const INLINE_ATTRIBUTES = new RegExp(
  String.raw`(?<=[\])\x60])${PANDOC_ATTRIBUTES}`,
  "gu",
);
const HEADING_ATTRIBUTES = [
  new RegExp(
    String.raw`^([ \t]{0,3}#{1,6}[ \t][^\n]*?[ \t])${PANDOC_ATTRIBUTES}[ \t]*\r?$`,
    "gmu",
  ),
  new RegExp(
    String.raw`^([^\n]*?\S[ \t]+)${PANDOC_ATTRIBUTES}[ \t]*(?=\r?\n[ \t]{0,3}(?:=+|-+)[ \t]*\r?$)`,
    "gmu",
  ),
];
const FENCED_DIV = /^[ \t]*:::.*$/gmu;

function blank(chars: string[], from: number, to: number) {
  for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
}

export function htmlCommentRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf("<!--", from);
    if (start === -1) return ranges;
    const end = text.indexOf("-->", start + 4);
    if (end === -1) return ranges;
    ranges.push([start, end + 3]);
    from = end + 3;
  }
}

function lineBracketRanges(
  text: string,
  open: string,
  close: string,
  opens: (text: string, start: number) => boolean,
  accept: (text: string, start: number, end: number) => boolean,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start === -1) return ranges;
    if (!opens(text, start)) {
      from = start + 1;
      continue;
    }
    let end = start + 1;
    while (end < text.length && text[end] !== close && text[end] !== "\n") end++;
    if (end < text.length && text[end] === close && accept(text, start, end + 1)) {
      ranges.push([start, end + 1]);
    }
    from = end + 1;
  }
}

const TAG_OPENING = /^<\/?[A-Za-z]/u;
const AUTOLINK_OPENING = /^<(?:https?:\/\/|mailto:)/iu;
const CITATION_KEY = /@[-\p{L}\p{N}_:.#/+]/u;
const AUTOLINK_OPENING_MAX = "<https://".length;

export function htmlTagRanges(text: string): Array<[number, number]> {
  return lineBracketRanges(
    text,
    "<",
    ">",
    (source, start) => TAG_OPENING.test(source.slice(start, start + 3)),
    () => true,
  );
}

export function autolinkRanges(text: string): Array<[number, number]> {
  return lineBracketRanges(
    text,
    "<",
    ">",
    (source, start) => AUTOLINK_OPENING.test(source.slice(start, start + AUTOLINK_OPENING_MAX)),
    (source, start, end) => {
      const opening = AUTOLINK_OPENING.exec(source.slice(start, start + AUTOLINK_OPENING_MAX));
      return opening !== null && start + opening[0].length < end - 1;
    },
  );
}

export function bracketedCitationRanges(text: string): Array<[number, number]> {
  return lineBracketRanges(
    text,
    "[",
    "]",
    () => true,
    (source, start, end) => CITATION_KEY.test(source.slice(start, end)),
  );
}

function closesFence(
  marker: RegExpExecArray | null,
  fence: { char: string; length: number },
): boolean {
  if (!marker) return false;
  const token = marker[1];
  return token.startsWith(fence.char) && token.length >= fence.length;
}

function continuesFootnote(line: string): boolean {
  return /^[ \t]*$/u.test(line) || /^(?: {2,}|\t)/u.test(line);
}

function maskNonProseLine(
  chars: string[],
  line: string,
  offset: number,
): void {
  // Standard indented code blocks, and reference-link definitions (an
  // identifier, target, and optional title): neither is rendered body
  // prose. Keeping newlines preserves all offsets.
  if (
    /^(?: {4}|\t)\S/u.test(line) ||
    /^[ \t]{0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S+/u.test(line)
  ) {
    blank(chars, offset, offset + line.length);
  }
}

function maskBlockLines(chars: string[], text: string): void {
  const lines = text.split(/(?<=\n)/);
  let offset = 0;
  let fence: { char: string; length: number } | null = null;
  let footnoteContinuation = false;
  for (const line of lines) {
    const marker = /^(?:(?:[ \t]{0,3}>[ \t]?)+)?[ \t]{0,3}(`{3,}|~{3,})/u.exec(
      line,
    );
    const footnote = /^[ \t]{0,3}\[\^[^\]\n]+\]:[ \t]*/u.exec(
      line,
    );
    if (fence) {
      blank(chars, offset, offset + line.length);
      if (closesFence(marker, fence)) fence = null;
    } else if (marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      blank(chars, offset, offset + line.length);
      footnoteContinuation = false;
    } else if (footnote) {
      blank(chars, offset, offset + footnote[0].length);
      footnoteContinuation = true;
    } else if (footnoteContinuation && continuesFootnote(line)) {
      // Indented footnote continuations remain visible prose.
    } else {
      footnoteContinuation = false;
      maskNonProseLine(chars, line, offset);
    }
    offset += line.length;
  }
}

function maskInlineCode(chars: string[]): void {
  const codeSource = chars.join("");
  let index = 0;
  while (index < codeSource.length) {
    if (codeSource[index] !== "`") {
      index++;
      continue;
    }
    let runEnd = index + 1;
    while (codeSource[runEnd] === "`") runEnd++;
    const delimiter = codeSource.slice(index, runEnd);
    let close = codeSource.indexOf(delimiter, runEnd);
    while (
      close >= 0 &&
      (codeSource[close - 1] === "`" ||
        codeSource[close + delimiter.length] === "`")
    ) {
      close = codeSource.indexOf(delimiter, close + delimiter.length);
    }
    if (close < 0) {
      index = runEnd;
      continue;
    }
    const end = close + delimiter.length;
    blank(chars, index, end);
    index = end;
  }
}

function bracketedSpanOpen(source: string, close: number): number {
  let depth = 0;
  for (let index = close; index >= 0 && source[index] !== "\n"; index--) {
    if (source[index] === "]") depth++;
    else if (source[index] === "[" && --depth === 0) return index;
  }
  return -1;
}

function maskPandocAttributes(chars: string[]): void {
  const source = chars.join("");
  for (const match of source.matchAll(INLINE_ATTRIBUTES)) {
    const at = match.index;
    blank(chars, at, at + match[0].length);
    if (source[at - 1] !== "]") continue;
    const open = bracketedSpanOpen(source, at - 1);
    if (open < 0) continue;
    blank(chars, open, open + 1);
    blank(chars, at - 1, at);
  }
  for (const pattern of HEADING_ATTRIBUTES) {
    for (const match of source.matchAll(pattern)) {
      const at = match.index + match[1].length;
      blank(chars, at, match.index + match[0].length);
    }
  }
  for (const match of source.matchAll(FENCED_DIV)) {
    blank(chars, match.index, match.index + match[0].length);
  }
}

function referenceBracketEnd(source: string, from: number): number {
  const close = source.indexOf("]", from);
  if (close < 0) return -1;
  const newline = source.indexOf("\n", from);
  if (newline >= 0 && newline < close) return -1;
  return close;
}

function referenceLinkEnd(source: string, start: number): number {
  let at = start;
  if (source[start] === "!") at += 1;
  if (source[at] !== "[") return -1;
  const label = referenceBracketEnd(source, at + 1);
  if (label < 0 || source[label + 1] !== "[") return -1;
  const reference = referenceBracketEnd(source, label + 2);
  if (reference < 0) return -1;
  return reference + 1;
}

function maskReferenceLinks(chars: string[]): void {
  const source = chars.join("");
  let index = 0;
  while (index < source.length) {
    const end = referenceLinkEnd(source, index);
    if (end < 0) {
      index += 1;
      continue;
    }
    blank(chars, source.lastIndexOf("[", end - 1), end);
    index = end;
  }
}

function linkDestinationEnd(links: string, index: number): number {
  let depth = 1;
  let cursor = index + 2;
  while (cursor < links.length && links[cursor] !== "\n") {
    if (links[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (links[cursor] === "(") depth++;
    if (links[cursor] === ")" && --depth === 0) {
      cursor++;
      break;
    }
    cursor++;
  }
  return cursor;
}

function maskLinkDestinations(chars: string[]): void {
  const links = chars.join("");
  let index = 0;
  while (index < links.length - 1) {
    if (links[index] !== "]" || links[index + 1] !== "(") {
      index++;
      continue;
    }
    const cursor = linkDestinationEnd(links, index);
    blank(chars, index + 1, cursor);
    index = Math.max(index, cursor - 1) + 1;
  }
}

export function maskMarkdown(text: string): string {
  const chars = text.split("");

  // YAML frontmatter is metadata, not document prose. Only recognize it at the
  // start of the document so a horizontal rule later in the body is untouched.
  const frontmatter = /^(?:﻿)?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(
    text,
  );
  if (frontmatter) blank(chars, 0, frontmatter[0].length);

  maskBlockLines(chars, text);

  for (const [from, to] of htmlCommentRanges(chars.join(""))) blank(chars, from, to);
  for (const match of chars
    .join("")
    .matchAll(
      /<(script|style|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
    )) {
    blank(chars, match.index!, match.index! + match[0].length);
  }
  for (const [from, to] of htmlTagRanges(chars.join(""))) blank(chars, from, to);
  maskPandocAttributes(chars);
  maskInlineCode(chars);
  maskLinkDestinations(chars);
  maskReferenceLinks(chars);
  for (const match of chars.join("").matchAll(/\[\^[^[\]\s]+\]/gu)) {
    blank(chars, match.index, match.index + match[0].length);
  }
  for (const [from, to] of autolinkRanges(chars.join(""))) blank(chars, from, to);
  for (const pattern of [
    /<[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}>/giu,
    /(?:https?:\/\/|www\.)[^\s<>()]+/giu,
    EMAIL_ADDRESS_PATTERN,
  ]) {
    for (const match of chars.join("").matchAll(pattern)) {
      blank(chars, match.index!, match.index! + match[0].length);
    }
  }
  // Pandoc citations are metadata references, not visible prose. Mask
  // bracketed multi-cites (including locator/prefix text) first, followed by
  // bare @key citations. E-mail addresses have already been masked above.
  for (const [from, to] of bracketedCitationRanges(chars.join(""))) blank(chars, from, to);
  for (const match of chars
    .join("")
    .matchAll(/(^|[^\p{L}\p{N}._%+-])@[-\p{L}\p{N}_:.#/+]+/gmu)) {
    const prefix = match[1]?.length ?? 0;
    blank(
      chars,
      match.index! + prefix,
      match.index! + match[0].length,
    );
  }
  for (const expression of scanMathExpressions(chars.join(""), {
    format: "markdown",
  })) {
    blank(chars, expression.from, expression.to);
  }
  return chars.join("");
}

export function markdownToProse(text: string): { prose: string; map: number[] } {
  const masked = maskMarkdown(text);
  let prose = "";
  const map: number[] = [];
  let pending = false;
  for (let i = 0; i < masked.length; i++) {
    const char = masked[i];
    if (/\s/.test(char)) {
      if (prose.length > 0) pending = true;
      continue;
    }
    if (pending) {
      pending = false;
      if (!TRAILING_PUNCT.has(char)) {
        prose += " ";
        map.push(i);
      }
    }
    prose += char;
    map.push(i);
  }
  return { prose, map };
}

export function markdownSpellcheckRanges(text: string): SpellingWord[] {
  return spellingWordRanges(maskMarkdown(text), text);
}
