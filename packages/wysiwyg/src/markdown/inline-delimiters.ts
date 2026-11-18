import { Fragment, type Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";

interface InlineRun {
  start: number;
  end?: number;
  delimiter: string;
}

interface Atom {
  from: number;
  to: number;
  word: boolean;
}

interface DelimiterState {
  out: string;
  inlines?: InlineRun[];
  verbatim?: [number, number][];
  atoms?: Atom[];
  normalizeInline?: (inline: InlineRun) => InlineRun;
}

const TAGS: Readonly<Record<string, string>> = { "**": "strong", "*": "em", "~~": "del" };
const SPACE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const RUN_OF_THREE = new Set(["*", "**"]);
const WORD = /[\p{L}\p{N}]/u;
const guarded = new WeakSet<object>();

function escapedAt(text: string, at: number): boolean {
  let slashes = 0;
  while (text[at - slashes - 1] === "\\") slashes++;
  return slashes % 2 === 1;
}

function atomAt(atoms: readonly Atom[], at: number): Atom | undefined {
  return atoms.find((atom) => atom.from <= at && at < atom.to);
}

function classAt(text: string, at: number, before: boolean, atoms: readonly Atom[]): "space" | "punctuation" | "other" {
  if (atomAt(atoms, before ? at - 1 : at)?.word) return "other";
  const code = before ? text.slice(Math.max(0, at - 2), at) : text.slice(at, at + 2);
  const char = before ? Array.from(code).at(-1) : Array.from(code)[0];
  if (!char || SPACE.test(char)) return "space";
  return PUNCTUATION.test(char) ? "punctuation" : "other";
}

function flanking(text: string, at: number, length: number, atoms: readonly Atom[]): { left: boolean; right: boolean; run: number } {
  const marker = text[at];
  let from = at;
  while (from > 0 && text[from - 1] === marker && !escapedAt(text, from - 1)) from--;
  let to = at + length;
  while (text[to] === marker) to++;
  const last = classAt(text, from, true, atoms);
  const next = classAt(text, to, false, atoms);
  return {
    left: next !== "space" && (next !== "punctuation" || last !== "other"),
    right: last !== "space" && (last !== "punctuation" || next !== "other"),
    run: to - from,
  };
}

function splitsQuotes(text: string, from: number, to: number, atoms: readonly Atom[]): boolean {
  let doubles = 0;
  let singles = 0;
  for (let at = from; at < to; at++) {
    const atom = atomAt(atoms, at);
    if (atom) {
      at = atom.to - 1;
    } else if (text[at] === '"' && !escapedAt(text, at)) {
      doubles++;
    } else if (text[at] === "'" && !escapedAt(text, at) && !(WORD.test(text[at - 1] ?? "") && WORD.test(text[at + 1] ?? ""))) {
      singles++;
    }
  }
  return doubles % 2 === 1 || singles % 2 === 1;
}

function placed(text: string, start: number, end: number, delimiter: string, atoms: readonly Atom[]): boolean {
  const length = delimiter.length;
  const opener = flanking(text, start, length, atoms);
  if (!opener.left || !flanking(text, end, length, atoms).right) return false;
  if (splitsQuotes(text, start + length, end, atoms)) return false;
  return !(RUN_OF_THREE.has(delimiter) && opener.run > length && opener.right);
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
  for (const atom of state.atoms ?? []) {
    if (atom.from >= at) atom.from += delta;
    if (atom.to >= at) atom.to += delta;
  }
}

function atomsWithin(state: DelimiterState, start: number, end: number): Atom[] {
  const atoms = state.atoms ?? [];
  const within: Atom[] = [];
  for (let index = atoms.length - 1; index >= 0 && atoms[index].to > start - 1; index--) {
    if (atoms[index].from <= end) within.push(atoms[index]);
  }
  return within;
}

function closesDollar(text: string, at: number): boolean {
  return text[at] === "$" && !escapedAt(text, at) && text[at - 1] !== "$" && text[at + 1] !== "$" && !SPACE.test(text[at - 1] ?? " ") && !/\d/u.test(text[at + 1] ?? "");
}

function opensDollar(text: string, at: number): boolean {
  return text[at] === "$" && !escapedAt(text, at) && text[at - 1] !== "$" && text[at + 1] !== undefined && text[at + 1] !== "$" && !SPACE.test(text[at + 1]);
}

function skippedAt(text: string, at: number): number {
  if (escapedAt(text, at)) return at;
  if (text[at] === "`") {
    let run = 1;
    while (text[at + run] === "`") run++;
    const close = text.indexOf("`".repeat(run), at + run);
    return close < 0 ? at + run - 1 : close + run - 1;
  }
  if (text[at] === "<" || (text[at] === "(" && text[at - 1] === "]")) {
    const close = text.indexOf(text[at] === "<" ? ">" : ")", at + 1);
    const line = text.indexOf("\n", at + 1);
    return close >= 0 && (line < 0 || close < line) ? close : at;
  }
  return at;
}

export function escapePairedDollars(state: unknown, from: number): void {
  const delimiters = state as DelimiterState;
  if (!delimiters.out.includes("$", from)) return;
  const atoms = atomsWithin(delimiters, from, delimiters.out.length);
  for (let at = from; at < delimiters.out.length; at++) {
    const text = delimiters.out;
    const atom = atomAt(atoms, at);
    if (atom) {
      at = atom.to - 1;
      continue;
    }
    const skipped = skippedAt(text, at);
    if (skipped > at || !opensDollar(text, at)) {
      at = skipped;
      continue;
    }
    let close = text.indexOf("$", at + 1);
    while (close >= 0 && !closesDollar(text, close)) close = text.indexOf("$", close + 1);
    if (close < 0) return;
    const closeInText = !atomAt(atoms, close);
    escapeAt(delimiters, at);
    if (closeInText) {
      escapeAt(delimiters, close + 1);
      at = close + 1;
    } else {
      at++;
    }
  }
}

function escapeAt(state: DelimiterState, at: number): void {
  state.out = `${state.out.slice(0, at)}\\${state.out.slice(at)}`;
  shift(state, { start: -1, delimiter: "" }, at, 1);
}

export function markAtom(state: unknown, from: number, to: number, word: boolean): void {
  const delimiters = state as DelimiterState;
  if (to > from) (delimiters.atoms ??= []).push({ from, to, word });
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

const EDGE_SPACE = /[ \t]/u;

// A run that starts or ends with spaces (a mark reopened after a nested one closed, "== three") moves those spaces
// outside its delimiters, as the serializer's expelEnclosingWhitespace means, so the delimiters can still open and close.
function expelledSpaces(state: DelimiterState, start: number, end: number, delimiter: string): [number, number] {
  const length = delimiter.length;
  let inner = start + length;
  while (inner < end && EDGE_SPACE.test(state.out[inner])) inner++;
  if (inner >= end) return [start, end];
  if (inner > start + length) {
    const spaces = state.out.slice(start + length, inner);
    state.out = state.out.slice(0, start) + spaces + delimiter + state.out.slice(inner);
    start += spaces.length;
  }
  let close = end;
  while (close > start + length && EDGE_SPACE.test(state.out[close - 1])) close--;
  if (close < end) {
    const spaces = state.out.slice(close, end);
    state.out = state.out.slice(0, close) + delimiter + spaces + state.out.slice(end + length);
    end = close;
  }
  return [start, end];
}

function placeDelimiters(state: DelimiterState, inline: InlineRun): InlineRun {
  let start = inline.start;
  while (SPACE.test(state.out.charAt(start))) start++;
  let end = inline.end ?? state.out.length;
  const { delimiter } = inline;
  if (state.out.slice(start, start + delimiter.length) !== delimiter || state.out.slice(end, end + delimiter.length) !== delimiter) return inline;
  [start, end] = expelledSpaces(state, start, end, delimiter);
  if (!placed(state.out, start, end, delimiter, atomsWithin(state, start, end + delimiter.length))) asTags(state, inline, start, end);
  return { delimiter: "", start: end, end };
}

function outerFirst(mark: Mark): number {
  return mark.attrs.syntax === "pandoc" ? 1 : 0;
}

export function nestMarks(parent: ProseMirrorNode): ProseMirrorNode {
  const children: ProseMirrorNode[] = [];
  parent.forEach((child) => {
    children.push(child);
  });
  if (!children.some((child) => child.marks.length > 1)) return parent;
  const reach = (from: number, mark: Mark) => {
    let to = from;
    while (to + 1 < children.length && mark.isInSet(children[to + 1].marks)) to++;
    return to;
  };
  let active: readonly Mark[] = [];
  let changed = false;
  const nested = children.map((child, index) => {
    let keep = 0;
    while (keep < active.length && active[keep].isInSet(child.marks)) keep++;
    const kept = active.slice(0, keep);
    const opened = child.marks
      .filter((mark) => !mark.isInSet(kept))
      .map((mark) => ({ mark, to: reach(index, mark) }))
      .sort((left, right) => right.to - left.to || outerFirst(right.mark) - outerFirst(left.mark))
      .map(({ mark }) => mark);
    active = [...kept, ...opened];
    if (active.every((mark, at) => mark === child.marks[at])) return child;
    changed = true;
    return child.mark(active);
  });
  return changed ? parent.copy(Fragment.fromArray(nested)) : parent;
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
