export interface TypstSpan {
  readonly from: number;
  readonly to: number;
}

const IDENTIFIER_START = /[\p{ID_Start}_]/u;
const IDENTIFIER_CONTINUE = /[\p{ID_Continue}_-]/u;

export function typstIdentifierEndAt(source: string, from: number): number {
  if (!IDENTIFIER_START.test(source[from] ?? "")) return from;
  let index = from + 1;
  while (index < source.length && IDENTIFIER_CONTINUE.test(source[index])) index += 1;
  return index;
}

function closedTypstStringEnd(source: string, from: number): number | null {
  let index = from + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") index += 2;
    else if (character === '"') return index + 1;
    else index += 1;
  }
  return null;
}

export function skipTypstString(source: string, from: number): number {
  return closedTypstStringEnd(source, from) ?? source.length;
}

function lineEnd(source: string, from: number): number {
  const newline = source.indexOf("\n", from);
  return newline < 0 ? source.length : newline;
}

function blockCommentEnd(source: string, from: number): number {
  let depth = 0;
  let index = from;
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

function commentEnd(source: string, index: number, markup: boolean): number | null {
  if (source[index] !== "/") return null;
  if (source[index + 1] === "/" && !(markup && source[index - 1] === ":")) return lineEnd(source, index);
  if (source[index + 1] === "*") return blockCommentEnd(source, index);
  return null;
}

function rawEnd(source: string, from: number): number {
  let ticks = 0;
  while (source[from + ticks] === "`") ticks += 1;
  if (ticks === 2) return from + 2;
  const fence = "`".repeat(ticks);
  const close = source.indexOf(fence, from + ticks);
  return close < 0 ? source.length : close + ticks;
}

export function skipTypstCode(source: string, from: number): number {
  const comment = commentEnd(source, from, false);
  if (comment !== null) return comment;
  switch (source[from]) {
    case '"':
      return skipTypstString(source, from);
    case "`":
      return rawEnd(source, from);
    case "[":
      return matchTypstContent(source, from + 1);
    case "$":
      return matchTypstMath(source, from + 1);
    case "(":
      return matchTypstCode(source, from + 1, ")");
    case "{":
      return matchTypstCode(source, from + 1, "}");
    default:
      return from + 1;
  }
}

export function matchTypstCode(source: string, from: number, close: string): number {
  let index = from;
  while (index < source.length) {
    const character = source[index];
    if (character === close) return index + 1;
    if (character === ")" || character === "]" || character === "}") return index;
    index = skipTypstCode(source, index);
  }
  return source.length;
}

function embeddedEnd(source: string, from: number): number {
  const next = source[from + 1];
  if (next === "(" || next === "{" || next === "[") return skipTypstCode(source, from + 1);
  let index = typstIdentifierEndAt(source, from + 1);
  if (index === from + 1) return from + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "(" || character === "[") {
      index = skipTypstCode(source, index);
    } else if (character === "." && IDENTIFIER_START.test(source[index + 1] ?? "")) {
      index = typstIdentifierEndAt(source, index + 1);
    } else {
      return index;
    }
  }
  return index;
}

export function matchTypstContent(source: string, from: number): number {
  let depth = 0;
  let index = from;
  while (index < source.length) {
    const character = source[index];
    const comment = commentEnd(source, index, true);
    if (comment !== null) {
      index = comment;
    } else if (character === "\\") {
      index += 2;
    } else if (character === "`") {
      index = rawEnd(source, index);
    } else if (character === "$") {
      index = matchTypstMath(source, index + 1);
    } else if (character === "#") {
      index = embeddedEnd(source, index);
    } else if (character === "[") {
      depth += 1;
      index += 1;
    } else if (character === "]") {
      if (depth === 0) return index + 1;
      depth -= 1;
      index += 1;
    } else {
      index += 1;
    }
  }
  return source.length;
}

export function matchTypstMath(source: string, from: number): number {
  let index = from;
  while (index < source.length) {
    const character = source[index];
    const comment = commentEnd(source, index, false);
    if (comment !== null) index = comment;
    else if (character === "\\") index += 2;
    else if (character === '"') index = skipTypstString(source, index);
    else if (character === "#") index = embeddedEnd(source, index);
    else if (character === "$") return index + 1;
    else index += 1;
  }
  return source.length;
}

export interface TypstArgument extends TypstSpan {
  readonly name: string | null;
  readonly value: TypstSpan;
}

const NAMED_ARGUMENT = /^([\p{ID_Start}_][\p{ID_Continue}_-]*)\s*:/u;

export function typstArguments(source: string, open: number): { args: TypstArgument[]; end: number } | null {
  if (source[open] !== "(") return null;
  const args: TypstArgument[] = [];
  let start = open + 1;
  let index = start;
  const push = (to: number) => {
    const raw = source.slice(start, to);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed === "") return;
    const from = start + leading;
    const end = from + trimmed.length;
    const named = NAMED_ARGUMENT.exec(trimmed);
    if (named) {
      let valueFrom = from + named[0].length;
      while (valueFrom < end && /\s/u.test(source[valueFrom])) valueFrom += 1;
      args.push({ from, to: end, name: named[1], value: { from: valueFrom, to: end } });
    } else {
      args.push({ from, to: end, name: null, value: { from, to: end } });
    }
  };
  while (index < source.length) {
    const character = source[index];
    if (character === ")") {
      push(index);
      return { args, end: index + 1 };
    }
    if (character === "]" || character === "}") return null;
    if (character === ",") {
      push(index);
      start = index + 1;
      index += 1;
      continue;
    }
    index = skipTypstCode(source, index);
  }
  return null;
}

export function typstStringValue(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith('"') || closedTypstStringEnd(trimmed, 0) !== trimmed.length) return null;
  let value = "";
  let index = 1;
  while (index < trimmed.length - 1) {
    const character = trimmed[index];
    index += 1;
    if (character !== "\\") {
      value += character;
      continue;
    }
    const next = trimmed[index];
    index += 1;
    if (next === "n") value += "\n";
    else if (next === "t") value += "\t";
    else if (next === "r") value += "\r";
    else if (next === "u" && trimmed[index] === "{") {
      const close = trimmed.indexOf("}", index);
      const code = Number.parseInt(trimmed.slice(index + 1, close), 16);
      if (close < 0 || Number.isNaN(code)) return null;
      value += String.fromCodePoint(code);
      index = close + 1;
    } else {
      value += next ?? "";
    }
  }
  return value;
}

export function typstStringLiteral(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', String.raw`\"`)
    .replaceAll("\n", String.raw`\n`);
  return `"${escaped}"`;
}
