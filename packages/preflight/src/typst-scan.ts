export const TYPST_MARKUP = 0;
export const TYPST_CODE = 1;
export const TYPST_STRING = 2;
export const TYPST_COMMENT = 3;
export const TYPST_RAW = 4;
export const TYPST_MATH = 5;
export const TYPST_ESCAPE = 6;

export const TYPST_LABEL = String.raw`[\p{L}\p{M}\p{N}\p{Pc}][\p{L}\p{M}\p{N}\p{Pc}.:-]*`;

const IDENT_START = /[\p{L}_]/u;
const IDENT_CONTINUE = /[\p{L}\p{M}\p{N}_-]/u;
const LINE_KEYWORDS = new Set(["let", "set", "show", "import", "include", "if", "for", "while", "context", "return"]);
const AUTOLINK = /[0-9A-Za-z!#$%&*+,\-./:;=?@_~']/;
const AUTOLINK_TRAILING = "!,.:;?'";

export interface TextRange {
  readonly from: number;
  readonly to: number;
}

export interface TypstScan {
  readonly text: string;
  readonly kinds: Uint8Array;
  readonly masked: string;
  readonly code: string;
  readonly markup: string;
  readonly comments: readonly TextRange[];
  readonly strings: readonly TextRange[];
}

interface MarkupFrame {
  t: "markup";
  inBrackets: boolean;
  depth: number;
}

interface MathFrame {
  t: "math";
}

interface ExprFrame {
  t: "expr";
  line: boolean;
  parens: number;
  braces: number;
  started: boolean;
  inIdent: boolean;
}

type Frame = MarkupFrame | MathFrame | ExprFrame;

interface Lexer {
  readonly text: string;
  readonly kinds: Uint8Array;
  readonly stack: Frame[];
  readonly comments: TextRange[];
  readonly strings: TextRange[];
}

function mark(lexer: Lexer, from: number, to: number, kind: number): void {
  lexer.kinds.fill(kind, from, Math.min(to, lexer.text.length));
}

function lineCommentEnd(text: string, from: number): number {
  const end = text.indexOf("\n", from);
  return end < 0 ? text.length : end;
}

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

function rawEnd(text: string, from: number): number {
  let ticks = 0;
  while (text[from + ticks] === "`") ticks++;
  if (ticks === 2) return from + 2;
  const fence = "`".repeat(ticks);
  const close = text.indexOf(fence, from + ticks);
  return close < 0 ? text.length : close + ticks;
}

function trivia(lexer: Lexer, i: number, allowRaw: boolean): number | null {
  const { text } = lexer;
  if (text.startsWith("//", i)) {
    const end = lineCommentEnd(text, i);
    mark(lexer, i, end, TYPST_COMMENT);
    lexer.comments.push({ from: i, to: end });
    return end;
  }
  if (text.startsWith("/*", i)) {
    const end = blockCommentEnd(text, i);
    mark(lexer, i, end, TYPST_COMMENT);
    lexer.comments.push({ from: i, to: end });
    return end;
  }
  if (allowRaw && text[i] === "`") {
    const end = rawEnd(text, i);
    mark(lexer, i, end, TYPST_RAW);
    return end;
  }
  return null;
}

function autolinkEnd(text: string, i: number): number | null {
  if (!text.startsWith("http://", i) && !text.startsWith("https://", i)) return null;
  if (i > 0 && /[\p{L}\p{N}]/u.test(text[i - 1])) return null;
  let end = i;
  while (end < text.length && AUTOLINK.test(text[end])) end++;
  while (end > i && AUTOLINK_TRAILING.includes(text[end - 1])) end--;
  return end;
}

function identifierAt(text: string, from: number): string {
  if (!IDENT_START.test(text[from] ?? "")) return "";
  let end = from + 1;
  while (end < text.length && IDENT_CONTINUE.test(text[end])) end++;
  return text.slice(from, end);
}

function opensExpression(text: string, i: number): boolean {
  const next = text[i + 1] ?? "";
  return IDENT_START.test(next) || next === "(" || next === "{" || next === "[" || next === '"';
}

function pushExpression(lexer: Lexer, i: number): number {
  const keyword = identifierAt(lexer.text, i + 1);
  mark(lexer, i, i + 1, TYPST_CODE);
  lexer.stack.push({
    t: "expr",
    line: LINE_KEYWORDS.has(keyword),
    parens: 0,
    braces: 0,
    started: false,
    inIdent: false,
  });
  return i + 1;
}

function markupStep(lexer: Lexer, frame: MarkupFrame, i: number): number {
  const { text } = lexer;
  const char = text[i];
  if (char === "\\") {
    const end = text[i + 1] === undefined || text[i + 1] === "\n" ? i + 1 : i + 2;
    mark(lexer, i, end, TYPST_ESCAPE);
    return end;
  }
  const link = autolinkEnd(text, i);
  if (link !== null) {
    mark(lexer, i, link, TYPST_ESCAPE);
    return link;
  }
  const skipped = trivia(lexer, i, true);
  if (skipped !== null) return skipped;
  if (char === "$") {
    mark(lexer, i, i + 1, TYPST_MATH);
    lexer.stack.push({ t: "math" });
    return i + 1;
  }
  if (char === "#" && opensExpression(text, i)) return pushExpression(lexer, i);
  if (frame.inBrackets && char === "[") frame.depth++;
  if (frame.inBrackets && char === "]") {
    if (frame.depth === 0) {
      mark(lexer, i, i + 1, TYPST_CODE);
      lexer.stack.pop();
      return i + 1;
    }
    frame.depth--;
  }
  return i + 1;
}

function mathStep(lexer: Lexer, i: number): number {
  const { text } = lexer;
  const char = text[i];
  if (char === "\\") {
    const end = Math.min(text.length, i + 2);
    mark(lexer, i, end, TYPST_MATH);
    return end;
  }
  const skipped = trivia(lexer, i, false);
  if (skipped !== null) return skipped;
  if (char === "#" && opensExpression(text, i)) return pushExpression(lexer, i);
  mark(lexer, i, i + 1, TYPST_MATH);
  if (char === "$") lexer.stack.pop();
  return i + 1;
}

function stringEnd(text: string, from: number): number {
  let i = from + 1;
  while (i < text.length) {
    if (text[i] === "\\") i += 2;
    else if (text[i] === '"') return i;
    else i++;
  }
  return text.length;
}

function consumeString(lexer: Lexer, i: number): number {
  const close = stringEnd(lexer.text, i);
  mark(lexer, i, i + 1, TYPST_CODE);
  mark(lexer, i + 1, close, TYPST_STRING);
  lexer.strings.push({ from: i + 1, to: close });
  if (close < lexer.text.length) mark(lexer, close, close + 1, TYPST_CODE);
  return Math.min(lexer.text.length, close + 1);
}

function openContent(lexer: Lexer, i: number): number {
  mark(lexer, i, i + 1, TYPST_CODE);
  lexer.stack.push({ t: "markup", inBrackets: true, depth: 0 });
  return i + 1;
}

function insideBrackets(stack: readonly Frame[]): boolean {
  for (let index = stack.length - 1; index >= 0; index--) {
    const frame = stack[index];
    if (frame.t === "markup") return frame.inBrackets;
  }
  return false;
}

function shallowExpressionStep(lexer: Lexer, frame: ExprFrame, i: number): number | null {
  const { text } = lexer;
  const char = text[i];
  if (frame.line) {
    if (char === "\n") {
      lexer.stack.pop();
      return i;
    }
    if ((char === "]" && insideBrackets(lexer.stack)) || char === ")" || char === "}") {
      lexer.stack.pop();
      return i;
    }
    return null;
  }
  if (!frame.started || frame.inIdent) {
    if (IDENT_CONTINUE.test(char) && (frame.inIdent || IDENT_START.test(char))) {
      frame.started = true;
      frame.inIdent = true;
      mark(lexer, i, i + 1, TYPST_CODE);
      return i + 1;
    }
  }
  if (frame.started && char === "." && IDENT_START.test(text[i + 1] ?? "")) {
    frame.inIdent = true;
    mark(lexer, i, i + 1, TYPST_CODE);
    return i + 1;
  }
  if (char === "(" || char === "[" || char === "{" || (char === '"' && !frame.started)) return null;
  lexer.stack.pop();
  return i;
}

function expressionStep(lexer: Lexer, frame: ExprFrame, i: number): number {
  const { text } = lexer;
  const skipped = trivia(lexer, i, true);
  if (skipped !== null) return skipped;
  if (frame.parens === 0 && frame.braces === 0) {
    const shallow = shallowExpressionStep(lexer, frame, i);
    if (shallow !== null) return shallow;
  }
  const char = text[i];
  frame.inIdent = false;
  frame.started = true;
  if (char === '"') return consumeString(lexer, i);
  if (char === "[") return openContent(lexer, i);
  mark(lexer, i, i + 1, TYPST_CODE);
  if (char === "(") frame.parens++;
  else if (char === "{") frame.braces++;
  else if (char === ")" && frame.parens > 0) frame.parens--;
  else if (char === "}" && frame.braces > 0) frame.braces--;
  return i + 1;
}

export function scanTypst(text: string): TypstScan {
  const lexer: Lexer = {
    text,
    kinds: new Uint8Array(text.length),
    stack: [{ t: "markup", inBrackets: false, depth: 0 }],
    comments: [],
    strings: [],
  };
  let i = 0;
  while (i < text.length) {
    const frame = lexer.stack.at(-1) ?? { t: "markup", inBrackets: false, depth: 0 };
    if (lexer.stack.length === 0) lexer.stack.push(frame);
    if (frame.t === "markup") i = markupStep(lexer, frame, i);
    else if (frame.t === "math") i = mathStep(lexer, i);
    else i = expressionStep(lexer, frame, i);
  }
  const keep = (accept: (kind: number) => boolean) => {
    let out = "";
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      out += char === "\n" || accept(lexer.kinds[index]) ? char : " ";
    }
    return out;
  };
  return {
    text,
    kinds: lexer.kinds,
    masked: keep((kind) => kind !== TYPST_COMMENT && kind !== TYPST_RAW),
    code: keep((kind) => kind === TYPST_CODE),
    markup: keep((kind) => kind === TYPST_MARKUP),
    comments: lexer.comments,
    strings: lexer.strings,
  };
}

export interface TypstArgument {
  readonly name: string | null;
  readonly from: number;
  readonly to: number;
  readonly valueFrom: number;
  readonly valueTo: number;
}

export interface TypstCall {
  readonly name: string;
  readonly from: number;
  readonly open: number;
  readonly close: number;
  readonly args: readonly TypstArgument[];
}

const OPENERS = "([{";
const CLOSERS = ")]}";

function matchingClose(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const char = code[i];
    if (OPENERS.includes(char)) depth++;
    else if (CLOSERS.includes(char)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length;
}

function trimmedRange(code: string, from: number, to: number): TextRange {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(code[start])) start++;
  while (end > start && /\s/.test(code[end - 1])) end--;
  return { from: start, to: end };
}

function argument(code: string, from: number, to: number): TypstArgument | null {
  const range = trimmedRange(code, from, to);
  if (range.from >= range.to) return null;
  const named = /^([\p{L}_][\p{L}\p{N}_-]*)\s*:/u.exec(code.slice(range.from, range.to));
  if (!named) return { name: null, from: range.from, to: range.to, valueFrom: range.from, valueTo: range.to };
  const value = trimmedRange(code, range.from + named[0].length, range.to);
  return { name: named[1], from: range.from, to: range.to, valueFrom: value.from, valueTo: value.to };
}

function splitArguments(code: string, open: number, close: number): TypstArgument[] {
  const args: TypstArgument[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const char = code[i];
    if (OPENERS.includes(char)) depth++;
    else if (CLOSERS.includes(char)) depth--;
    else if (char === "," && depth === 0) {
      const arg = argument(code, start, i);
      if (arg) args.push(arg);
      start = i + 1;
    }
  }
  const last = argument(code, start, close);
  if (last) args.push(last);
  return args;
}

function escapeName(name: string): string {
  return name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export function callAt(scan: TypstScan, name: string, from: number, open: number): TypstCall {
  const close = matchingClose(scan.code, open);
  return { name, from, open, close, args: splitArguments(scan.code, open, close) };
}

export function closingBracket(scan: TypstScan, open: number): number {
  return matchingClose(scan.code, open);
}

export function typstCalls(scan: TypstScan, names: readonly string[]): TypstCall[] {
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}_.\-])(${names.map(escapeName).join("|")})\s*\(`,
    "gu",
  );
  return [...scan.code.matchAll(pattern)].map((match) =>
    callAt(scan, match[1], match.index, match.index + match[0].length - 1),
  );
}

export function typstMethodCalls(scan: TypstScan, method: string): TypstCall[] {
  const pattern = new RegExp(String.raw`\.(${escapeName(method)})\s*\(`, "gu");
  return [...scan.code.matchAll(pattern)].map((match) =>
    callAt(scan, match[1], match.index, match.index + match[0].length - 1),
  );
}

export function typstShowRuleCalls(scan: TypstScan): TypstCall[] {
  const pattern =
    /(?<![\p{L}\p{N}_.-])show\s*:\s*(?:[\p{L}_][\p{L}\p{N}_-]*\s*=>\s*)?([\p{L}_][\p{L}\p{N}_.-]*)\s*\(/gu;
  return [...scan.code.matchAll(pattern)].map((match) =>
    callAt(scan, match[1], match.index, match.index + match[0].length - 1),
  );
}

export function namedArgument(call: TypstCall, name: string): TypstArgument | undefined {
  return call.args.find((arg) => arg.name === name);
}

export function positionalArgument(scan: TypstScan, call: TypstCall, index = 0): TypstArgument | undefined {
  return call.args.filter((arg) => arg.name === null && !scan.code.startsWith("..", arg.from))[index];
}

export interface TypstStringValue {
  readonly value: string;
  readonly from: number;
  readonly to: number;
}

export function unescapeTypstString(raw: string): string {
  return raw.replace(/\\(.)/g, (_, character: string) => {
    if (character === "n") return "\n";
    if (character === "t") return "\t";
    return character;
  });
}

export function stringValue(scan: TypstScan, from: number, to: number): TypstStringValue | null {
  const range = trimmedRange(scan.code, from, to);
  if (scan.code[range.from] !== '"' || scan.code[range.to - 1] !== '"' || range.to - range.from < 2) return null;
  const literal = scan.strings.find((item) => item.from === range.from + 1 && item.to === range.to - 1);
  if (!literal) return null;
  return { value: unescapeTypstString(scan.text.slice(literal.from, literal.to)), from: literal.from, to: literal.to };
}

export function stringsWithin(scan: TypstScan, from: number, to: number): TypstStringValue[] {
  return scan.strings
    .filter((item) => item.from >= from && item.to <= to)
    .map((item) => ({ value: unescapeTypstString(scan.text.slice(item.from, item.to)), from: item.from, to: item.to }));
}

export function isBlankValue(scan: TypstScan, from: number, to: number): boolean {
  const range = trimmedRange(scan.code, from, to);
  const code = scan.code.slice(range.from, range.to).replace(/\s+/g, "");
  if (code === "none" || code === "()" || code === "") return true;
  if (code === '""') return stringValue(scan, range.from, range.to)?.value.trim() === "";
  if (code === "[]") return scan.text.slice(range.from + 1, range.to - 1).trim() === "";
  return false;
}

export function isCodeAt(scan: TypstScan, offset: number): boolean {
  return scan.kinds[offset] === TYPST_CODE;
}

export function typstVersionAtLeast(version: string | undefined, minimum: readonly number[]): boolean {
  if (!version) return true;
  const parts = version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .slice(0, minimum.length)
    .map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part))) return true;
  for (let index = 0; index < minimum.length; index++) {
    const actual = parts[index] ?? 0;
    if (actual !== minimum[index]) return actual > minimum[index];
  }
  return true;
}

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash + 1);
}

export function normalizeProjectPath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

export function isExternalTypstPath(raw: string): boolean {
  return raw.startsWith("@") || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
}

export function resolveTypstPath(fromFile: string | undefined, raw: string): string | null {
  if (isExternalTypstPath(raw)) return null;
  const base = raw.startsWith("/") ? raw.slice(1) : directoryOf(fromFile ?? "") + raw;
  return normalizeProjectPath(base);
}
