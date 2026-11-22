import { decodeTypstString } from "@oleafly/editor/typst-literals";
import {
  isTypstEscaped,
  maskTypstSource,
  TYPST_LABEL_PATTERN,
  TYPST_NAME_CHARACTER_PATTERN,
  trimTypstReference,
} from "@oleafly/editor/typst-syntax";
import type { FileSymbols, Sym, SymKind } from "./types";

export { maskTypstSource, typstRawEnd } from "@oleafly/editor/typst-syntax";

type SymSpan = {
  readonly from: number;
  readonly to: number;
  readonly nameFrom: number;
  readonly nameTo: number;
};

function resolveImport(from: string, raw: string): string | null {
  if (raw.startsWith("@") || raw.includes("://") || raw.startsWith("/")) return null;
  const parts = [...from.split("/").slice(0, -1), ...raw.replace(/^\.\//, "").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  const target = normalized.join("/");
  const dot = target.indexOf(".", target.lastIndexOf("/") + 1);
  const hasExtension = dot >= 0 && dot < target.length - 1;
  return hasExtension ? target : `${target}.typ`;
}

type Range = { readonly from: number; readonly to: number };

const HEADING_CALL = /#heading(?=[([])/g;
const CLOSERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

function closingIndex(code: string, open: number): number {
  const stack: string[] = [];
  for (let at = open; at < code.length; at++) {
    const char = code[at];
    if (char === "\\") {
      at++;
      continue;
    }
    const top = stack.at(-1);
    const closer = top === "]" && char !== "[" ? undefined : CLOSERS[char];
    if (closer) stack.push(closer);
    else if (char === top) {
      stack.pop();
      if (stack.length === 0) return at;
    }
  }
  return -1;
}

function argumentRanges(code: string, from: number, to: number): Range[] {
  const ranges: Range[] = [];
  let start = from;
  let at = from;
  while (at < to) {
    if (CLOSERS[code[at]]) {
      const close = closingIndex(code, at);
      if (close < 0) break;
      at = close + 1;
      continue;
    }
    if (code[at] === ",") {
      ranges.push({ from: start, to: at });
      start = at + 1;
    }
    at += 1;
  }
  ranges.push({ from: start, to });
  return ranges;
}

function trimmed(text: string, range: Range): Range {
  const slice = text.slice(range.from, range.to);
  const from = range.from + slice.length - slice.trimStart().length;
  return { from, to: from + slice.trim().length };
}

interface HeadingBody {
  readonly title: string;
  readonly name: Range;
}

interface HeadingCall extends HeadingBody {
  readonly level: number;
  readonly to: number;
}

function headingBody(text: string, value: Range): HeadingBody | null {
  if (text[value.from] === "[") {
    const name = trimmed(text, { from: value.from + 1, to: value.to - 1 });
    return { title: text.slice(name.from, name.to), name };
  }
  const title = decodeTypstString(text.slice(value.from, value.to));
  return title === null ? null : { title, name: { from: value.from + 1, to: value.to - 1 } };
}

function headingCall(text: string, code: string, at: number): HeadingCall | null {
  let end = at + "#heading".length;
  const named = new Map<string, number>();
  let body: HeadingBody | null = null;
  if (code[end] === "(") {
    const close = closingIndex(code, end);
    if (close < 0) return null;
    for (const range of argumentRanges(code, end + 1, close)) {
      const value = trimmed(text, range);
      const written = text.slice(value.from, value.to);
      const pair = /^([a-z]+)\s*:\s*(\d+)$/u.exec(written);
      if (pair) named.set(pair[1], Number(pair[2]));
      else if (written !== "" && !/^[a-z-]+\s*:/u.test(written)) body ??= headingBody(text, value);
    }
    end = close + 1;
  }
  if (code[end] === "[") {
    const close = closingIndex(code, end);
    if (close < 0) return null;
    body = headingBody(text, { from: end, to: close + 1 });
    end = close + 1;
  }
  if (!body || body.title.trim() === "") return null;
  const level = named.get("level") ?? (named.get("depth") ?? 1) + (named.get("offset") ?? 0);
  return { ...body, level: Math.max(1, level), to: end };
}

interface TypstSection {
  readonly title: string;
  readonly span: SymSpan;
  readonly level: number;
}

function markerSections(text: string): TypstSection[] {
  const sections: TypstSection[] = [];
  for (const match of text.matchAll(/^[ \t]*(=+)[ \t]+(\S[^\n]*)$/gm)) {
    const title = match[2].replace(/(?<![ \t])[ \t]+<[^>]+>[ \t]*$/, "").trim();
    if (!title) continue;
    const nameFrom = match.index + match[0].length - match[2].length + match[2].indexOf(title);
    sections.push({
      title,
      span: {
        from: match.index + match[0].indexOf("="),
        to: match.index + match[0].length,
        nameFrom,
        nameTo: nameFrom + title.length,
      },
      level: match[1].length - 1,
    });
  }
  return sections;
}

function calledSections(text: string, code: string): TypstSection[] {
  const sections: TypstSection[] = [];
  for (const match of code.matchAll(HEADING_CALL)) {
    const call = isTypstEscaped(code, match.index) ? null : headingCall(text, code, match.index);
    if (!call) continue;
    sections.push({
      title: call.title,
      span: { from: match.index, to: call.to, nameFrom: call.name.from, nameTo: call.name.to },
      level: call.level - 1,
    });
  }
  return sections;
}

function typstSections(text: string, code: string): TypstSection[] {
  return [...markerSections(text), ...calledSections(text, code)].sort(
    (left, right) => left.span.from - right.span.from,
  );
}

export function parseTypstFile(path: string, rawText: string): FileSymbols {
  const { text, code } = maskTypstSource(rawText);
  const defs: Sym[] = [];
  const uses: Sym[] = [];
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const push = (
    list: Sym[], kind: SymKind, name: string, span: SymSpan, extra?: Partial<Sym>,
  ) => list.push({ kind, name, file: path, line: lineAt(span.from), ...span, ...extra });

  for (const section of typstSections(text, code)) {
    push(defs, "section", section.title, section.span, { level: section.level });
  }

  const label = new RegExp(`<(${TYPST_LABEL_PATTERN})>`, "gu");
  for (const match of code.matchAll(label)) {
    if (isTypstEscaped(code, match.index)) continue;
    const nameFrom = match.index + 1;
    push(defs, "label", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    });
  }

  const atUse = new RegExp(
    `(?<!${TYPST_NAME_CHARACTER_PATTERN})@(${TYPST_LABEL_PATTERN})`,
    "gu",
  );
  for (const match of code.matchAll(atUse)) {
    if (isTypstEscaped(code, match.index)) continue;
    const name = trimTypstReference(match[1]);
    const at = match.index;
    const nameFrom = at + 1;
    push(uses, "atuse", name, {
      from: at,
      to: nameFrom + name.length,
      nameFrom,
      nameTo: nameFrom + name.length,
    });
  }

  const input = /#(?:include|import)\s+"([^"]+)"/g;
  for (const match of text.matchAll(input)) {
    const target = resolveImport(path, match[1]);
    if (!target) continue;
    const nameFrom = match.index + match[0].indexOf(match[1]);
    push(uses, "inputedge", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    }, { target });
  }
  return { file: path, defs, uses };
}
