import type { FileSymbols, Sym, SymKind } from "./types";

type SymSpan = {
  readonly from: number;
  readonly to: number;
  readonly nameFrom: number;
  readonly nameTo: number;
};

function maskTypstBlockStep(
  text: string,
  i: number,
  blockDepth: number,
): { out: string; next: number; depth: number } {
  if (text.startsWith("/*", i)) {
    return { out: "  ", next: i + 2, depth: blockDepth + 1 };
  }
  if (text.startsWith("*/", i)) {
    return { out: "  ", next: i + 2, depth: blockDepth - 1 };
  }
  return { out: text[i] === "\n" ? "\n" : " ", next: i + 1, depth: blockDepth };
}

function maskTypstComments(text: string): string {
  let out = "";
  let i = 0;
  let blockDepth = 0;
  while (i < text.length) {
    if (blockDepth > 0) {
      const step = maskTypstBlockStep(text, i, blockDepth);
      out += step.out;
      i = step.next;
      blockDepth = step.depth;
    } else if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (text.startsWith("/*", i)) {
      blockDepth = 1;
      out += "  ";
      i += 2;
    } else {
      out += text[i++];
    }
  }
  return out;
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
  i: number,
  frame: MarkupFrame,
  frames: Frame[],
): number {
  const char = text[i];
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
  chars: string[],
  i: number,
  frame: CodeFrame,
  frames: Frame[],
): number {
  const char = text[i];
  if (char === '"') {
    frame.quoted = true;
    chars[i] = " ";
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

function maskStrings(text: string): string {
  const chars = text.split("");
  const frames: Frame[] = [{ mode: "markup", close: false, brackets: 0 }];
  let i = 0;
  while (i < text.length) {
    const frame = frames.at(-1) as Frame;
    if (frame.mode === "markup") i = maskMarkupStep(text, i, frame, frames);
    else if (frame.quoted) i = maskQuotedStep(text, chars, i, frame);
    else i = maskCodeStep(text, chars, i, frame, frames);
  }
  return chars.join("");
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
  const text = maskTypstComments(rawText);
  const code = maskStrings(text);
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

  const label = /<([A-Za-z_][\w:-]*)>/g;
  for (const match of code.matchAll(label)) {
    const nameFrom = match.index + 1;
    push(defs, "label", match[1], {
      from: match.index,
      to: match.index + match[0].length,
      nameFrom,
      nameTo: nameFrom + match[1].length,
    });
  }

  const atUse = /(?:^|[^\w])@([A-Za-z_][\w:-]*)/g;
  for (const match of code.matchAll(atUse)) {
    const at = match.index + match[0].lastIndexOf("@");
    const nameFrom = at + 1;
    push(uses, "atuse", match[1], {
      from: at,
      to: at + match[1].length + 1,
      nameFrom,
      nameTo: nameFrom + match[1].length,
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
