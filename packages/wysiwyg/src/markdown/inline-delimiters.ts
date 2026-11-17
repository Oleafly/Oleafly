interface InlineRun {
  start: number;
  end?: number;
  delimiter: string;
}

interface DelimiterState {
  out: string;
  inlines?: InlineRun[];
  verbatim?: [number, number][];
  normalizeInline?: (inline: InlineRun) => InlineRun;
}

const TAGS: Readonly<Record<string, string>> = { "**": "strong", "*": "em", "~~": "del" };
const SPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const ESCAPABLE = /[!-/:-@[-`{-~]/u;
const STRUCTURE = new Set(["*", "_", "~", "`", "[", "]", "$"]);
const ENTITY_START = /^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/iu;
const ENTITY_END = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);$/iu;
const TAG_START = /^<(?:\/?[a-z]|[!?])/iu;
const TAG_END = /(?:<\/?[a-z][^<>]*|--)>$/iu;
const LINK_END = /\]\([^\n]*\)$/u;
const guarded = new WeakSet<object>();

function escapedAt(text: string, at: number): boolean {
  let slashes = 0;
  while (text[at - slashes - 1] === "\\") slashes++;
  return slashes % 2 === 1;
}

function classAt(text: string, at: number, before: boolean): "space" | "punctuation" | "other" {
  const code = before ? text.slice(Math.max(0, at - 2), at) : text.slice(at, at + 2);
  const char = before ? Array.from(code).at(-1) : Array.from(code)[0];
  if (!char || SPACE.test(char)) return "space";
  return PUNCTUATION.test(char) ? "punctuation" : "other";
}

function flanking(text: string, at: number, length: number): { left: boolean; right: boolean } {
  const marker = text[at];
  let from = at;
  while (from > 0 && text[from - 1] === marker && !escapedAt(text, from - 1)) from--;
  let to = at + length;
  while (text[to] === marker) to++;
  const last = classAt(text, from, true);
  const next = classAt(text, to, false);
  return {
    left: next !== "space" && (next !== "punctuation" || last !== "other"),
    right: last !== "space" && (last !== "punctuation" || next !== "other"),
  };
}

function unitAfter(text: string, at: number, limit: number): number {
  if (at >= limit) return 0;
  const char = text[at];
  if (char === "\\") return at + 1 < limit && ESCAPABLE.test(text[at + 1]) ? 2 : 0;
  if (char === "&") return ENTITY_START.exec(text.slice(at, limit))?.[0].length ?? 1;
  if (char === "<") return TAG_START.test(text.slice(at, limit)) ? 0 : 1;
  if (STRUCTURE.has(char)) return 0;
  return (text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1;
}

function unitBefore(text: string, at: number, limit: number): number {
  if (at <= limit) return 0;
  const char = text[at - 1];
  if (at - 2 >= limit && text[at - 2] === "\\" && ESCAPABLE.test(char) && !escapedAt(text, at - 2)) return 2;
  if (char === ";") return ENTITY_END.exec(text.slice(limit, at))?.[0].length ?? 1;
  if (char === ">") return TAG_END.test(text.slice(limit, at)) ? 0 : 1;
  if (char === ")") return LINK_END.test(text.slice(limit, at)) ? 0 : 1;
  if (STRUCTURE.has(char) || "<&\\".includes(char)) return 0;
  return at - 2 >= limit && (text.codePointAt(at - 2) ?? 0) > 0xffff ? 2 : 1;
}

function moved(text: string, from: number, to: number, length: number): string {
  const delimiter = text.slice(from, from + length);
  if (to > from) return text.slice(0, from) + text.slice(from + length, to + length) + delimiter + text.slice(to + length);
  return text.slice(0, to) + delimiter + text.slice(to, from) + text.slice(from + length);
}

function placed(text: string, start: number, end: number, delimiter: string): string | null {
  const length = delimiter.length;
  let out = text;
  let open = start;
  let close = end;
  while (!flanking(out, open, length).left) {
    const step = unitAfter(out, open + length, close);
    if (step === 0 || open + length + step >= close) return null;
    out = moved(out, open, open + step, length);
    open += step;
  }
  while (!flanking(out, close, length).right) {
    const step = unitBefore(out, close, open + length);
    if (step === 0 || close - step <= open + length) return null;
    out = moved(out, close, close - step, length);
    close -= step;
  }
  return out;
}

function shift(state: DelimiterState, current: InlineRun, at: number, delta: number): void {
  for (const inline of state.inlines ?? []) {
    if (inline === current) continue;
    if (inline.start >= at) inline.start += delta;
    if (inline.end !== undefined && inline.end >= at) inline.end += delta;
  }
  for (const range of state.verbatim ?? []) {
    if (range[0] >= at) range[0] += delta;
    if (range[1] >= at) range[1] += delta;
  }
}

function asTags(state: DelimiterState, inline: InlineRun, start: number, end: number): void {
  const { delimiter } = inline;
  const tag = TAGS[delimiter];
  if (!tag) return;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  state.out = state.out.slice(0, end) + close + state.out.slice(end + delimiter.length);
  shift(state, inline, end + delimiter.length, close.length - delimiter.length);
  state.out = state.out.slice(0, start) + open + state.out.slice(start + delimiter.length);
  shift(state, inline, start + delimiter.length, open.length - delimiter.length);
}

function placeDelimiters(state: DelimiterState, inline: InlineRun): InlineRun {
  let start = inline.start;
  while (SPACE.test(state.out.charAt(start))) start++;
  const end = inline.end ?? state.out.length;
  const { delimiter } = inline;
  if (state.out.slice(start, start + delimiter.length) !== delimiter || state.out.slice(end, end + delimiter.length) !== delimiter) return inline;
  const out = placed(state.out, start, end, delimiter);
  if (out === null) asTags(state, inline, start, end);
  else state.out = out;
  return { delimiter: "", start: end, end };
}

// tiptap-markdown trims each finished delimiter run by calling normalizeInline and then
// moving the delimiter one character at a time until it can open or close, which splits
// escapes, entities and HTML tags. Placing the delimiters here leaves its trim nothing to do.
export function guardInlineDelimiters(state: unknown): void {
  const delimiters = state as DelimiterState;
  if (guarded.has(delimiters) || typeof delimiters.normalizeInline !== "function") return;
  guarded.add(delimiters);
  delimiters.normalizeInline = (inline) => placeDelimiters(delimiters, inline);
}
