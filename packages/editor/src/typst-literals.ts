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

function bracketsBalanced(text: string): boolean {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === "\\") index += 1;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

export function sanitizeTypstContent(markup: string): string {
  return bracketsBalanced(markup) ? markup : markup.replaceAll(/(?<!\\)([[\]])/gu, String.raw`\$1`);
}

export function decodeTypstNumber(source: string, integer: boolean): number | null {
  const text = source.trim();
  const whole = INTEGER.exec(text);
  if (whole) {
    const digits = whole[2].toLowerCase();
    const magnitude = digits.length > 2 && /^0[xob]/u.test(digits) ? Number(digits) : Number.parseInt(digits, 10);
    const value = whole[1] ? -magnitude : magnitude;
    return Number.isSafeInteger(value) ? value : null;
  }
  if (integer || !FLOAT.test(text)) return null;
  const value = Number(text.replaceAll(/\s/gu, ""));
  return Number.isFinite(value) ? value : null;
}

export function encodeTypstNumber(value: number, integer: boolean): string | null {
  if (!Number.isFinite(value)) return null;
  if (integer) return Number.isSafeInteger(value) ? String(value) : null;
  return String(value).replace("e+", "e");
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
