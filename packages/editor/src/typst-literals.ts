const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  '"': '"',
  n: "\n",
  r: "\r",
  t: "\t",
};

const BACKSLASH = "\\";

const ENCODED: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  '"': String.raw`\"`,
  "\n": String.raw`\n`,
  "\r": String.raw`\r`,
  "\t": String.raw`\t`,
};

const INTEGER = /^(-?)\s*(0x[\da-f]+|0o[0-7]+|0b[01]+|\d+)$/iu;
const FLOAT = /^-?\s*(?:\d+\.\d*|\.\d+|\d+)(?:e[+-]?\d+)?$/iu;

const NEWLINE = /[\n\v\f\r\u0085\u2028\u2029]/u;
const ID_START = /[\p{XID_Start}_]/u;
const ID_CONTINUE = /[\p{XID_Continue}_-]/u;
const URL_CHARACTER = /[\dA-Za-z!#$%&*+,\-./:;=?@_~']/u;

// The escape that starts with the backslash at `body[index]`: what it stands for and how
// many characters it spans. An unknown escape keeps its backslash, as in Typst.
function readEscape(body: string, index: number): { readonly text: string; readonly length: number } | null {
  const next = body[index + 1];
  if (next === undefined) return null;
  const simple = SIMPLE_ESCAPES[next];
  if (simple !== undefined) return { text: simple, length: 2 };
  if (next !== "u" || body[index + 2] !== "{") return { text: BACKSLASH, length: 1 };
  const hex = /^[\da-f]*/iu.exec(body.slice(index + 3))?.[0] ?? "";
  const length = 3 + hex.length + (body[index + 3 + hex.length] === "}" ? 1 : 0);
  const code = hex === "" ? Number.NaN : Number.parseInt(hex, 16);
  const valid = code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
  return { text: valid ? String.fromCodePoint(code) : body.slice(index, index + length), length };
}

// Mirrors Typst's own unescaping: an unknown escape, or a \u{..} that names no character,
// stays in the value as written. Only a string that isn't one literal reads as null.
export function decodeTypstString(literal: string): string | null {
  if (literal.length < 2 || !literal.startsWith('"') || !literal.endsWith('"')) return null;
  const body = literal.slice(1, -1);
  let value = "";
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (character === '"') return null;
    const escape = character === BACKSLASH ? readEscape(body, index) : { text: character, length: 1 };
    if (!escape) return null;
    value += escape.text;
    index += escape.length;
  }
  return value;
}

export function encodeTypstString(value: string): string {
  let literal = '"';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const encoded = ENCODED[character];
    if (encoded) literal += encoded;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) literal += `${BACKSLASH}u{${code.toString(16)}}`;
    else literal += character;
  }
  return `${literal}"`;
}

type Mode = "markup" | "code" | "math";

interface Frame {
  readonly mode: Mode;
  readonly close: string;
  readonly at: number;
  readonly inMarkup: boolean;
}

function lineCommentEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length && !NEWLINE.test(text[index])) index += 1;
  return index;
}

// Block comments nest, as in Typst's lexer. One that never closes runs to the end.
function blockCommentEnd(text: string, from: number): number | null {
  let depth = 1;
  let index = from + 2;
  while (index < text.length && depth > 0) {
    if (text.startsWith("*/", index)) {
      depth -= 1;
      index += 2;
    } else if (text.startsWith("/*", index)) {
      depth += 1;
      index += 2;
    } else {
      index += 1;
    }
  }
  return depth > 0 ? null : index;
}

function backticks(text: string, from: number): number {
  let ticks = 0;
  while (text[from + ticks] === "`") ticks += 1;
  return ticks;
}

function rawEnd(text: string, from: number): number | null {
  const ticks = backticks(text, from);
  if (ticks === 2) return from + 2;
  let found = 0;
  for (let index = from + ticks; index < text.length; index += 1) {
    found = text[index] === "`" ? found + 1 : 0;
    if (found === ticks) return index + 1;
  }
  return null;
}

function stringEnd(text: string, from: number): number {
  let index = from + 1;
  while (index < text.length) {
    if (text[index] === '"') return index + 1;
    index += text[index] === BACKSLASH ? 2 : 1;
  }
  return text.length;
}

// A link takes URL characters and balanced brackets, minus trailing punctuation, as in Typst's lexer.
function linkEnd(text: string, from: number): number {
  const open: string[] = [];
  let index = from + (text.startsWith("https://", from) ? 8 : 7);
  for (; index < text.length; index += 1) {
    const character = text[index];
    if (character === "[" || character === "(") open.push(character);
    else if (character === "]" || character === ")") {
      if (open.pop() !== (character === "]" ? "[" : "(")) break;
    } else if (!URL_CHARACTER.test(character)) break;
  }
  while ("!,.:;?'".includes(text[index - 1])) index -= 1;
  return index;
}

// Where the comment, escape, raw text, string or link at `index` ends, or null when none starts
// there. Each is lexed in the modes Typst lexes it in, so the brackets inside never count.
function tokenEnd(text: string, index: number, mode: Mode): number | null {
  const character = text[index];
  if (text.startsWith("//", index)) return lineCommentEnd(text, index);
  if (text.startsWith("/*", index)) return blockCommentEnd(text, index) ?? text.length;
  if (character === BACKSLASH && mode !== "code") return index + 2;
  if (character === "`" && mode !== "math") return rawEnd(text, index) ?? text.length;
  if (character === '"' && mode !== "markup") return stringEnd(text, index);
  const link = mode === "markup" && character === "h" && /^https?:\/\//u.test(text.slice(index, index + 8));
  return link ? linkEnd(text, index) : null;
}

function identifierEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const character = String.fromCodePoint(text.codePointAt(index) as number);
    if (!(index === from ? ID_START : ID_CONTINUE).test(character)) break;
    index += character.length;
  }
  return index;
}

function opened(frames: Frame[], mode: Mode, close: string, at: number): number {
  frames.push({ mode, close, at, inMarkup: false });
  return at + 1;
}

function embeddedCode(text: string, from: number, frames: Frame[]): number {
  if (text[from] === '"') return stringEnd(text, from);
  if (text[from] === "{") return opened(frames, "code", "}", from);
  let index = identifierEnd(text, from);
  while (text[index] === "." && identifierEnd(text, index + 1) > index + 1) index = identifierEnd(text, index + 1);
  if (text[index] === "(") return opened(frames, "code", ")", index);
  return text[index] === "[" ? opened(frames, "markup", "]", index) : index;
}

function openerOf(mode: Mode, character: string): { readonly mode: Mode; readonly close: string } | null {
  if (character === "$" && mode !== "math") return { mode: "math", close: "$" };
  if (character === "[" && mode !== "math") return { mode: "markup", close: "]" };
  if (mode !== "code") return null;
  if (character === "(") return { mode: "code", close: ")" };
  return character === "{" ? { mode: "code", close: "}" } : null;
}

function unclosedToken(text: string, index: number, mode: Mode): { readonly escapes: number[]; readonly next: number } | null {
  if (mode === "code") return null;
  if (text.startsWith("//", index) && lineCommentEnd(text, index) === text.length) return { escapes: [index], next: index + 1 };
  if (text.startsWith("/*", index) && blockCommentEnd(text, index) === null) {
    return { escapes: [index, index + 1], next: index + 2 };
  }
  if (text.startsWith("*/", index)) return { escapes: [index], next: index + 1 };
  if (mode !== "markup" || text[index] !== "`" || rawEnd(text, index) !== null) return null;
  const ticks = backticks(text, index);
  return { escapes: Array.from({ length: ticks }, (_, tick) => index + tick), next: index + ticks };
}

// What Typst would leave unmatched in this markup: one scan that follows markup, code and math,
// steps over escapes, comments, raw text, strings and links, and pairs each `]` with the nearest
// open `[`. A trailing backslash is counted as an unpaired escape.
function unmatched(markup: string): { readonly escapes: number[]; readonly equation: number | null } {
  const frames: Frame[] = [];
  const escapes: number[] = [];
  let index = 0;
  while (index < markup.length) {
    const frame = frames.at(-1);
    const mode = frame?.mode ?? "markup";
    const unclosed = unclosedToken(markup, index, mode);
    if (unclosed) {
      escapes.push(...unclosed.escapes);
      index = unclosed.next;
      continue;
    }
    const end = tokenEnd(markup, index, mode);
    if (end !== null) {
      index = end;
      continue;
    }
    const character = markup[index];
    const opener = openerOf(mode, character);
    index += 1;
    if (frame?.close === character) frames.pop();
    else if (character === "#" && mode !== "code") index = embeddedCode(markup, index, frames);
    else if (opener) frames.push({ ...opener, at: index - 1, inMarkup: mode === "markup" });
    else if (character === "]" && !frame) escapes.push(index - 1);
  }
  const equation = frames.find((frame) => frame.close === "$" && frame.inMarkup)?.at ?? null;
  for (const frame of frames) if (frame.close === "]") escapes.push(frame.at);
  if (index > markup.length) escapes.push(markup.length);
  return { escapes: escapes.sort((a, b) => a - b), equation };
}

function withEscapes(text: string, positions: readonly number[]): string {
  let out = "";
  let from = 0;
  for (const at of positions) {
    out += `${text.slice(from, at)}${BACKSLASH}`;
    from = at;
  }
  return out + text.slice(from);
}

// Content is kept verbatim except for what Typst would leave unmatched, which is escaped, and a
// trailing backslash, which is doubled so it can't escape the closing `]`.
export function sanitizeTypstContent(markup: string): string {
  let text = markup;
  let scan = unmatched(text);
  while (scan.equation !== null) {
    text = withEscapes(text, [scan.equation]);
    scan = unmatched(text);
  }
  return withEscapes(text, scan.escapes);
}

export function decodeTypstNumber(source: string, integer: boolean): number | null {
  const text = source.trim();
  const whole = INTEGER.exec(text);
  if (whole) {
    const magnitude = Number(whole[2].toLowerCase());
    const value = whole[1] ? -magnitude : magnitude;
    if (Number.isSafeInteger(value)) return value;
    return integer || !Number.isFinite(value) ? null : value;
  }
  if (integer || !FLOAT.test(text)) return null;
  const value = Number(text.replaceAll(/\s/gu, ""));
  return Number.isFinite(value) ? value : null;
}

// Float fields write the number the way it is typed, except that from 1e15 up it is written
// with an exponent: a run of 16 or more digits is a Typst integer, and past i64 an error.
export function encodeTypstNumber(value: number, integer: boolean): string | null {
  if (!Number.isFinite(value)) return null;
  if (integer) return Number.isSafeInteger(value) ? String(value) : null;
  return (Math.abs(value) >= 1e15 ? value.toExponential() : String(value)).replace("e+", "e");
}

export function decodeTypstBool(source: string): boolean | null {
  const text = source.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

export function encodeTypstBool(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}
