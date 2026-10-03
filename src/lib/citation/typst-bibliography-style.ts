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

interface ArgumentScan {
  readonly source: string;
  readonly end: number;
  readonly stack: string[];
  index: number;
  style: StyleArgument | null;
  valueFrom: number | null;
  argumentStart: boolean;
}

function finishValue(scan: ArgumentScan): void {
  const { valueFrom } = scan;
  if (valueFrom === null) return;
  let valueTo = scan.index;
  while (valueTo > valueFrom && scan.source[valueTo - 1].trim() === "") valueTo -= 1;
  scan.style = { valueFrom, valueTo };
  scan.valueFrom = null;
}

function startArgument(scan: ArgumentScan): void {
  const start = skipTrivia(scan.source, scan.index, scan.end);
  scan.argumentStart = false;
  const value = scan.style === null ? styleValueStart(scan.source, start, scan.end) : null;
  if (value !== null) scan.valueFrom = value;
  scan.index = value ?? start;
}

function trackNesting(stack: string[], character: string): void {
  const closer = OPENERS[character];
  if (closer && (stack.at(-1) !== "]" || character === "[")) stack.push(closer);
  else if (character === stack.at(-1)) stack.pop();
}

function stepArgument(scan: ArgumentScan): boolean {
  const { source, stack } = scan;
  const character = source[scan.index];
  const comment = skipComment(source, scan.index);
  if (comment !== null) {
    scan.index = comment;
    return false;
  }
  if (character === "\\") {
    scan.index += 2;
    return false;
  }
  if (stack.at(-1) !== "]" && character === '"') {
    scan.index = skipString(source, scan.index);
    return false;
  }
  if (stack.length === 0 && (character === "," || character === ")")) {
    finishValue(scan);
    if (character === ")") return true;
    scan.argumentStart = true;
  } else {
    trackNesting(stack, character);
  }
  scan.index += 1;
  return false;
}

function readArguments(source: string, open: number, end: number): CallArguments | null {
  const scan: ArgumentScan = {
    source,
    end,
    stack: [],
    index: open + 1,
    style: null,
    valueFrom: null,
    argumentStart: true,
  };
  while (scan.index < end) {
    if (scan.stack.length === 0 && scan.argumentStart) startArgument(scan);
    else if (stepArgument(scan)) return { close: scan.index, style: scan.style };
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
  const escaped = value.replaceAll("\\", String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
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
