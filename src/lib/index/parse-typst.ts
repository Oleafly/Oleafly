import {
  isTypstEscaped,
  TYPST_LABEL_PATTERN,
  TYPST_NAME_CHARACTER_PATTERN,
  trimTypstReference,
  typstAutolinkEnd,
} from "@oleafly/editor/typst-syntax";
import type { FileSymbols, Sym, SymKind } from "./types";

type SymSpan = {
  readonly from: number;
  readonly to: number;
  readonly nameFrom: number;
  readonly nameTo: number;
};

type Masks = { readonly text: string[]; readonly code: string[] };

function blockCommentEnd(text: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return text.length;
}

export function typstRawEnd(text: string, from: number): number {
  let width = 1;
  while (text[from + width] === "`") width++;
  if (width === 2) return from + 2;
  const close = text.indexOf("`".repeat(width), from + width);
  return close < 0 ? from + width : close + width;
}

function opaqueEnd(text: string, i: number): number | null {
  if (text.startsWith("//", i)) {
    const end = text.indexOf("\n", i);
    return end < 0 ? text.length : end;
  }
  if (text.startsWith("/*", i)) return blockCommentEnd(text, i);
  if (text[i] === "`") return typstRawEnd(text, i);
  return null;
}

function blankOpaque(
  text: string,
  masks: Masks,
  from: number,
  to: number,
): number {
  for (let index = from; index < to; index++) {
    if (text[index] === "\n") continue;
    masks.text[index] = " ";
    masks.code[index] = " ";
  }
  return to;
}

type MarkupFrame = { mode: "markup"; close: boolean; brackets: number };
type CodeFrame = {
  mode: "code";
  line: boolean;
  started: boolean;
  parens: number;
  braces: number;
  quoted: boolean;
};
type Frame = MarkupFrame | CodeFrame;

const LINE_CODE_KEYWORDS = ["let", "set", "show", "import", "include"];

function opensLineCode(text: string, hash: number): boolean {
  let start = hash + 1;
  while (text[start] === " " || text[start] === "\t") start++;
  return LINE_CODE_KEYWORDS.some((word) => {
    if (!text.startsWith(word, start)) return false;
    const next = text[start + word.length];
    return next === undefined || !/\w/.test(next);
  });
}

function maskMarkupStep(
  text: string,
  masks: Masks,
  i: number,
  frame: MarkupFrame,
  frames: Frame[],
): number {
  const char = text[i];
  if (char === "\\") return i + 2;
  const link = typstAutolinkEnd(text, i);
  if (link !== null) {
    for (let index = i; index < link; index++) masks.code[index] = " ";
    return link;
  }
  const opaque = opaqueEnd(text, i);
  if (opaque !== null) return blankOpaque(text, masks, i, opaque);
  if (frame.close && char === "]" && frame.brackets === 0) {
    frames.pop();
    return i + 1;
  }
  if (frame.close && char === "[") {
    frame.brackets++;
    return i + 1;
  }
  if (frame.close && char === "]") {
    frame.brackets--;
    return i + 1;
  }
  if (char === "#") {
    frames.push({
      mode: "code",
      line: opensLineCode(text, i),
      started: false,
      parens: 0,
      braces: 0,
      quoted: false,
    });
  }
  return i + 1;
}

function maskQuotedStep(
  text: string,
  chars: string[],
  i: number,
  frame: CodeFrame,
): number {
  const char = text[i];
  let cursor = i;
  if (char !== "\n") chars[cursor] = " ";
  if (char === "\\" && cursor + 1 < text.length) {
    cursor++;
    if (text[cursor] !== "\n") chars[cursor] = " ";
  } else if (char === '"') {
    frame.quoted = false;
  }
  return cursor + 1;
}

function maskCodeStep(
  text: string,
  masks: Masks,
  i: number,
  frame: CodeFrame,
  frames: Frame[],
): number {
  const char = text[i];
  const opaque = opaqueEnd(text, i);
  if (opaque !== null) {
    frame.started = true;
    return blankOpaque(text, masks, i, opaque);
  }
  if (char === '"') {
    frame.quoted = true;
    masks.code[i] = " ";
    frame.started = true;
    return i + 1;
  }
  if (char === "[") {
    frame.started = true;
    frames.push({ mode: "markup", close: true, brackets: 0 });
    return i + 1;
  }
  if (char === "(") {
    frame.parens++;
    frame.started = true;
    return i + 1;
  }
  if (char === "{") {
    frame.braces++;
    frame.started = true;
    return i + 1;
  }
  if (char === ")" && frame.parens > 0) {
    frame.parens--;
    return i + 1;
  }
  if (char === "}" && frame.braces > 0) {
    frame.braces--;
    return i + 1;
  }
  if (char === "\n" && frame.line) {
    frames.pop();
    return i;
  }
  if (
    frame.started &&
    !frame.line &&
    frame.parens === 0 &&
    frame.braces === 0 &&
    /\s/.test(char)
  ) {
    frames.pop();
    return i;
  }
  if (!/\s/.test(char)) frame.started = true;
  return i + 1;
}

export function maskTypstSource(rawText: string): { text: string; code: string } {
  const masks: Masks = { text: rawText.split(""), code: rawText.split("") };
  const frames: Frame[] = [{ mode: "markup", close: false, brackets: 0 }];
  let i = 0;
  while (i < rawText.length) {
    const frame = frames.at(-1) as Frame;
    if (frame.mode === "markup") i = maskMarkupStep(rawText, masks, i, frame, frames);
    else if (frame.quoted) i = maskQuotedStep(rawText, masks.code, i, frame);
    else i = maskCodeStep(rawText, masks, i, frame, frames);
  }
  return { text: masks.text.join(""), code: masks.code.join("") };
}

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

  const heading = /^(={1,6})[ \t]+([^\n]+)$/gm;
  for (const match of text.matchAll(heading)) {
    const rawTitle = match[2].replace(/(?<![ \t])[ \t]+<[^>]+>[ \t]*$/, "").trim();
    if (!rawTitle) continue;
    const nameFrom = match.index + match[0].indexOf(match[2]) + match[2].indexOf(rawTitle);
    push(defs, "section", rawTitle, {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + rawTitle.length,
    }, { level: match[1].length - 1 });
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
