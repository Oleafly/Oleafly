import { typstBibliographyCalls } from "./typst-bibliography";

interface StyleArgument {
  readonly valueFrom: number;
  readonly valueTo: number;
}

interface CallArguments {
  readonly close: number;
  readonly style: StyleArgument | null;
}

const OPENERS: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };

function skipString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length && source[index] !== '"') index += source[index] === "\\" ? 2 : 1;
  return index + 1;
}

function skipComment(source: string, index: number): number | null {
  if (source[index] !== "/") return null;
  if (source[index + 1] === "/" && source[index - 1] !== ":") {
    const newline = source.indexOf("\n", index);
    return newline < 0 ? source.length : newline;
  }
  if (source[index + 1] === "*") {
    const close = source.indexOf("*/", index + 2);
    return close < 0 ? source.length : close + 2;
  }
  return null;
}

function skipTrivia(source: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    if (source[index].trim() === "") {
      index += 1;
      continue;
    }
    const comment = skipComment(source, index);
    if (comment === null) return index;
    index = comment;
  }
  return index;
}

function styleValueStart(source: string, start: number, end: number): number | null {
  const head = /^style\s*:/u.exec(source.slice(start, Math.min(end, start + 32)));
  return head ? skipTrivia(source, start + head[0].length, end) : null;
}

function readArguments(source: string, open: number, end: number): CallArguments | null {
  const stack: string[] = [];
  let style: StyleArgument | null = null;
  let valueFrom: number | null = null;
  let argumentStart = true;
  let index = open + 1;
  const finishValue = (at: number) => {
    if (valueFrom === null) return;
    let valueTo = at;
    while (valueTo > valueFrom && source[valueTo - 1].trim() === "") valueTo -= 1;
    style = { valueFrom, valueTo };
    valueFrom = null;
  };
  while (index < end) {
    const character = source[index];
    const inContent = stack.at(-1) === "]";
    if (stack.length === 0 && argumentStart) {
      const start = skipTrivia(source, index, end);
      argumentStart = false;
      const value = style === null ? styleValueStart(source, start, end) : null;
      if (value !== null) {
        valueFrom = value;
        index = value;
        continue;
      }
      index = start;
      continue;
    }
    const comment = skipComment(source, index);
    if (comment !== null) {
      index = comment;
    } else if (character === "\\") {
      index += 2;
    } else if (!inContent && character === '"') {
      index = skipString(source, index);
    } else if (stack.length === 0 && character === ",") {
      finishValue(index);
      argumentStart = true;
      index += 1;
    } else if (stack.length === 0 && character === ")") {
      finishValue(index);
      return { close: index, style };
    } else if (OPENERS[character] && (!inContent || character === "[")) {
      stack.push(OPENERS[character]);
      index += 1;
    } else {
      if (character === stack.at(-1)) stack.pop();
      index += 1;
    }
  }
  return null;
}

function bibliographyArguments(source: string): CallArguments | null {
  const call = typstBibliographyCalls(source).find(
    (candidate) => candidate.declares && source[candidate.from] === "#",
  );
  if (!call) return null;
  const open = source.indexOf("(", call.from);
  return open < 0 || open >= call.to ? null : readArguments(source, open, call.to);
}

const STRING_LITERAL = /^"((?:[^"\\]|\\.)*)"$/su;

export function typstBibliographyStyleValue(source: string): string | null | undefined {
  const parsed = bibliographyArguments(source);
  if (!parsed) return undefined;
  if (!parsed.style) return null;
  const literal = STRING_LITERAL.exec(source.slice(parsed.style.valueFrom, parsed.style.valueTo));
  return literal ? literal[1].replace(/\\(.)/gsu, "$1") : null;
}

function typstString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function setTypstBibliographyStyle(source: string, style: string): string | null {
  const parsed = bibliographyArguments(source);
  if (!parsed) return null;
  const literal = typstString(style);
  if (parsed.style) {
    return `${source.slice(0, parsed.style.valueFrom)}${literal}${source.slice(parsed.style.valueTo)}`;
  }
  let last = parsed.close;
  while (last > 0 && source[last - 1].trim() === "") last -= 1;
  if (source[last - 1] === ",") {
    return `${source.slice(0, last)} style: ${literal},${source.slice(last)}`;
  }
  return `${source.slice(0, last)}, style: ${literal}${source.slice(last)}`;
}
