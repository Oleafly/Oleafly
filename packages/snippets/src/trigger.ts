export type EndClass = "digit" | "letter" | string;

export const REGEX_PREFIX = "re:";
export const EVERY_KEY: EndClass = "every";

const LETTER_CLASS = /^(?:a-z|A-Z|\\p\{L(?:etter)?\})+$/u;
const LETTER_PROPERTY = /^L(?:etter)?$/u;
const QUANTIFIER = /^(?:([*+?])|\{(\d+)(?:,\d*)?\})\??/u;
const REPEAT = /(?:[*+?]|\{\d+,\d*\})\??/y;
const LITERAL_ESCAPE = /^[^A-Za-z0-9]$/u;

export function compileTrigger(source: string): RegExp {
  if (hasNestedQuantifier(source)) throw new SyntaxError("A repeated group repeats inside");
  return new RegExp(`(?:${source})$`, "u");
}

function atomEnd(source: string, index: number): number {
  if (source[index] === "\\") return escapeAt(source, index)[1];
  if (source[index] === "[") return classEnd(source, index);
  return index + 1;
}

function repeatLength(source: string, index: number): number {
  REPEAT.lastIndex = index;
  return REPEAT.exec(source)?.[0].length ?? 0;
}

function loops(token: string): boolean {
  if (token[0] === "*" || token[0] === "+") return true;
  const bounds = /^\{(\d+),(\d*)\}/u.exec(token);
  return bounds !== null && (bounds[2] === "" || Number(bounds[2]) > 1);
}

export function hasNestedQuantifier(source: string): boolean {
  const groups: boolean[] = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === "(") {
      groups.push(false);
      index += source[index + 1] === "?" ? 2 : 1;
      continue;
    }
    const closes = source[index] === ")";
    const inner = closes && groups.pop() === true;
    index = closes ? index + 1 : atomEnd(source, index);
    const repeat = repeatLength(source, index);
    if (inner && loops(source.slice(index, index + repeat))) return true;
    if ((repeat > 0 || inner) && groups.length > 0) groups[groups.length - 1] = true;
    index += repeat;
  }
  return false;
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") index += 2;
    else if (char === "[") index = classEnd(source, index);
    else {
      if (char === "(") depth += 1;
      else if (char === ")" && --depth === 0) return index;
      index += 1;
    }
  }
  return source.length;
}

function classEnd(source: string, open: number): number {
  let index = open + 1;
  while (index < source.length && source[index] !== "]") index += source[index] === "\\" ? 2 : 1;
  return index + 1;
}

function classOf(content: string): EndClass {
  if (content.startsWith("^")) return EVERY_KEY;
  if (content === "0-9" || content === "\\d") return "digit";
  if (LETTER_CLASS.test(content)) return "letter";
  if (content.length === 1) return content;
  if (content.length === 2 && content[0] === "\\" && LITERAL_ESCAPE.test(content[1])) return content[1];
  return EVERY_KEY;
}

type Atom = [EndClass | null, number];

function escapeAt(source: string, index: number): Atom {
  const next = source[index + 1] ?? "";
  if (next === "d") return ["digit", index + 2];
  if (next === "b" || next === "B") return [null, index + 2];
  if (next === "p" || next === "P") {
    const close = source.indexOf("}", index);
    const end = close < 0 ? source.length : close + 1;
    const property = source.slice(index + 3, end - 1);
    return [next === "p" && LETTER_PROPERTY.test(property) ? "letter" : EVERY_KEY, end];
  }
  if (next === "u" && source[index + 2] === "{") {
    const close = source.indexOf("}", index);
    return [EVERY_KEY, close < 0 ? source.length : close + 1];
  }
  if (next === "u") return [EVERY_KEY, index + 6];
  if (next === "x") return [EVERY_KEY, index + 4];
  if (next === "c") return [EVERY_KEY, index + 3];
  if (next === "k" && source[index + 2] === "<") {
    const close = source.indexOf(">", index);
    return [EVERY_KEY, close < 0 ? source.length : close + 1];
  }
  if (/\d/u.test(next)) {
    let end = index + 1;
    while (/\d/u.test(source[end] ?? "")) end += 1;
    return [EVERY_KEY, end];
  }
  return [LITERAL_ESCAPE.test(next) ? next : EVERY_KEY, index + 2];
}

function groupClass(content: string): EndClass | null {
  if (content.startsWith("?:")) return sequenceClass(content.slice(2));
  if (/^\?<?[=!]/u.test(content)) return null;
  if (content.startsWith("?<")) return sequenceClass(content.slice(content.indexOf(">") + 1));
  return content.startsWith("?") ? EVERY_KEY : sequenceClass(content);
}

function atomAt(source: string, index: number): Atom {
  const char = source[index];
  if (char === "\\") return escapeAt(source, index);
  if (char === "[") {
    const end = classEnd(source, index);
    return [classOf(source.slice(index + 1, end - 1)), end];
  }
  if (char === "(") {
    const close = matchingParen(source, index);
    return [groupClass(source.slice(index + 1, close)), close + 1];
  }
  if (char === "^" || char === "$") return [null, index + 1];
  if (char === ".") return [EVERY_KEY, index + 1];
  return [char, index + 1];
}

function sequenceClass(source: string): EndClass {
  const alternatives: EndClass[] = [];
  let current: EndClass = EVERY_KEY;
  let index = 0;
  while (index < source.length) {
    if (source[index] === "|") {
      alternatives.push(current);
      current = EVERY_KEY;
      index += 1;
      continue;
    }
    const [atom, next] = atomAt(source, index);
    index = next;
    const quantifier = QUANTIFIER.exec(source.slice(index));
    let optional = false;
    if (quantifier) {
      optional = quantifier[1] === "*" || quantifier[1] === "?" || quantifier[2] === "0";
      index += quantifier[0].length;
    }
    if (atom !== null) current = optional ? EVERY_KEY : atom;
  }
  alternatives.push(current);
  return alternatives.every((entry) => entry === alternatives[0]) ? alternatives[0] : EVERY_KEY;
}

export function regexEndClass(source: string): EndClass {
  return sequenceClass(source);
}
