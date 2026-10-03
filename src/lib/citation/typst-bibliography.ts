export interface TypstBibliographySource {
  readonly path: string;
  readonly from: number;
  readonly to: number;
}

export interface TypstBibliographyCall {
  readonly from: number;
  readonly to: number;
  readonly declares: boolean;
  readonly sources: readonly TypstBibliographySource[];
}

interface TypstString {
  readonly value: string;
  readonly from: number;
  readonly to: number;
  readonly end: number;
}

const CALLEE = "bibliography";
const STRING_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  '"': '"',
  n: "\n",
  r: "\r",
  t: "\t",
};

function isIdentifierCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_-]/u.test(character);
}

function isLinkComment(source: string, index: number): boolean {
  return source[index - 1] === ":";
}

function lineEnd(source: string, index: number): number {
  const newline = source.indexOf("\n", index);
  return newline < 0 ? source.length : newline;
}

function blockCommentEnd(source: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    if (source.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else if (source.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  return source.length;
}

function commentEnd(source: string, index: number): number | null {
  if (source[index] !== "/") return null;
  if (source[index + 1] === "/" && !isLinkComment(source, index)) return lineEnd(source, index);
  if (source[index + 1] === "*") return blockCommentEnd(source, index);
  return null;
}

function rawEnd(source: string, start: number): number {
  let ticks = 0;
  while (source[start + ticks] === "`") ticks += 1;
  if (ticks === 2) return start + 2;
  const fence = "`".repeat(ticks);
  const close = source.indexOf(fence, start + ticks);
  return close < 0 ? start + ticks : close + ticks;
}

function skipTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (source[index].trim() === "") {
      index += 1;
      continue;
    }
    const end = commentEnd(source, index);
    if (end === null) return index;
    index = end;
  }
  return index;
}

function readUnicodeEscape(source: string, index: number): { text: string; end: number } {
  const close = source.indexOf("}", index + 3);
  const hex = close < 0 ? "" : source.slice(index + 3, close);
  const codePoint = /^[0-9a-f]{1,6}$/i.test(hex) ? Number.parseInt(hex, 16) : Number.NaN;
  if (Number.isNaN(codePoint) || codePoint > 0x10ffff) return { text: "\\", end: index + 1 };
  return { text: String.fromCodePoint(codePoint), end: close + 1 };
}

function readString(source: string, start: number): TypstString {
  let value = "";
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    const character = source[index];
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }
    const next = source[index + 1];
    if (next === "u" && source[index + 2] === "{") {
      const unicode = readUnicodeEscape(source, index);
      value += unicode.text;
      index = unicode.end;
    } else if (next !== undefined && STRING_ESCAPES[next] !== undefined) {
      value += STRING_ESCAPES[next];
      index += 2;
    } else {
      value += character;
      index += 1;
    }
  }
  return { value, from: start + 1, to: index, end: Math.min(source.length, index + 1) };
}

const EXPRESSION_ENDS = new Set([",", ")", "]", "}"]);

function expressionCloser(character: string, inContent: boolean): string | null {
  if (character === "[") return "]";
  if (inContent) return null;
  if (character === "(") return ")";
  return character === "{" ? "}" : null;
}

function skippedExpressionPart(source: string, index: number, inContent: boolean): number | null {
  const comment = commentEnd(source, index);
  if (comment !== null) return comment;
  const character = source[index];
  if (character === "\\") return index + 2;
  if (!inContent && character === '"') return readString(source, index).end;
  if (inContent && character === "`") return rawEnd(source, index);
  return null;
}

function skipExpression(source: string, start: number): number {
  const closers: string[] = [];
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (closers.length === 0 && EXPRESSION_ENDS.has(character)) return index;
    const inContent = closers.at(-1) === "]";
    const skipped = skippedExpressionPart(source, index, inContent);
    if (skipped !== null) {
      index = skipped;
      continue;
    }
    const closer = expressionCloser(character, inContent);
    if (closer) closers.push(closer);
    else if (character === closers.at(-1)) closers.pop();
    index += 1;
  }
  return index;
}

function skipArgument(source: string, index: number): number {
  const next = skipExpression(source, index);
  return next === index ? index + 1 : next;
}

function namedArgumentValueStart(source: string, start: number): number | null {
  let index = start;
  if (source[index] === '"') {
    index = readString(source, index).end;
  } else {
    while (isIdentifierCharacter(source[index])) index += 1;
    if (index === start) return null;
  }
  const colon = skipTrivia(source, index);
  return source[colon] === ":" ? colon + 1 : null;
}

function isArgumentBoundary(source: string, index: number): boolean {
  return source[index] === "," || source[index] === ")";
}

function readArrayStrings(source: string, open: number): { strings: TypstString[]; end: number } {
  const strings: TypstString[] = [];
  let index = open + 1;
  while (index < source.length) {
    index = skipTrivia(source, index);
    const character = source[index];
    if (character === ")") return { strings, end: index + 1 };
    if (character === ",") {
      index += 1;
      continue;
    }
    const named = namedArgumentValueStart(source, index);
    if (named !== null) {
      index = skipExpression(source, named);
      continue;
    }
    if (character === '"') {
      const item = readString(source, index);
      const after = skipTrivia(source, item.end);
      if (isArgumentBoundary(source, after)) {
        strings.push(item);
        index = after;
        continue;
      }
    }
    index = skipArgument(source, index);
  }
  return { strings, end: source.length };
}

function singleString(source: string, start: number): { strings: TypstString[]; end: number } {
  const item = readString(source, start);
  return { strings: [item], end: item.end };
}

function positionalStrings(
  source: string,
  index: number,
): { strings: TypstString[]; after: number } | null {
  const character = source[index];
  if (character !== '"' && character !== "(") return null;
  const read = character === '"' ? singleString(source, index) : readArrayStrings(source, index);
  const after = skipTrivia(source, read.end);
  return isArgumentBoundary(source, after) ? { strings: read.strings, after } : null;
}

function readArguments(
  source: string,
  open: number,
): { sources: TypstBibliographySource[]; declares: boolean; end: number } {
  const sources: TypstBibliographySource[] = [];
  let declares = false;
  let index = open + 1;
  const push = (item: TypstString) => sources.push({ path: item.value, from: item.from, to: item.to });
  while (index < source.length) {
    index = skipTrivia(source, index);
    const character = source[index];
    if (character === ")") return { sources, declares, end: index + 1 };
    if (character === ",") {
      index += 1;
      continue;
    }
    const named = namedArgumentValueStart(source, index);
    if (named !== null) {
      index = skipExpression(source, named);
      continue;
    }
    declares = true;
    const positional = positionalStrings(source, index);
    if (positional) {
      positional.strings.forEach(push);
      index = positional.after;
      continue;
    }
    index = skipArgument(source, index);
  }
  return { sources, declares, end: source.length };
}

function isCalleeAt(source: string, index: number, escapedEnd: number): boolean {
  if (index === escapedEnd || !source.startsWith(CALLEE, index)) return false;
  const before = source[index - 1];
  return !isIdentifierCharacter(before) && before !== "." && source[index + CALLEE.length] === "(";
}

function readCall(source: string, index: number): { call: TypstBibliographyCall | null; next: number } {
  const hashed = source[index - 1] === "#";
  const parsed = readArguments(source, index + CALLEE.length);
  if (!hashed && parsed.sources.length === 0) return { call: null, next: index + CALLEE.length };
  return {
    call: {
      from: hashed ? index - 1 : index,
      to: parsed.end,
      declares: parsed.declares,
      sources: parsed.sources,
    },
    next: parsed.end,
  };
}

export function typstBibliographyCalls(source: string): TypstBibliographyCall[] {
  const calls: TypstBibliographyCall[] = [];
  let escapedEnd = -1;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const comment = commentEnd(source, index);
    if (comment !== null) {
      index = comment;
    } else if (character === "\\") {
      index += 2;
      escapedEnd = index;
    } else if (character === "`") {
      index = rawEnd(source, index);
    } else if (isCalleeAt(source, index, escapedEnd)) {
      const read = readCall(source, index);
      if (read.call) calls.push(read.call);
      index = read.next;
    } else {
      index += 1;
    }
  }
  return calls;
}

export function typstBibliographySources(source: string): string[] {
  return typstBibliographyCalls(source).flatMap((call) => call.sources.map((item) => item.path));
}

export function hasTypstBibliography(source: string): boolean {
  return typstBibliographyCalls(source).some((call) => call.declares);
}
