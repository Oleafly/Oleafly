import { preserveCase } from "@oleafly/editor";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface NoteFindQuery {
  readonly search: string;
  readonly replace: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly regexp: boolean;
}

export interface NoteFindMatch {
  readonly from: number;
  readonly to: number;
  readonly groups: readonly string[];
}

export interface NoteFindState {
  readonly query: NoteFindQuery | null;
  readonly valid: boolean;
  readonly matches: readonly NoteFindMatch[];
  readonly active: number;
  readonly marks: DecorationSet;
  readonly shown: DecorationSet;
}

export const MAX_FIND_MATCHES = 2000;
export const MATCH_CLASS = "note-find-match";
export const ACTIVE_MATCH_CLASS = "note-find-match-active";

const ATOM = "￼";
const WORD = /[\p{L}\p{N}_]/u;
const REGEXP_SPECIALS = /[\\^$.*+?()[\]{}|]/g;
const ESCAPES: Readonly<Record<string, string>> = { n: "\n", r: "\r", t: "\t", "\\": "\\" };

export const noteFindKey = new PluginKey<NoteFindState>("noteFind");

const CLOSED: NoteFindState = {
  query: null,
  valid: true,
  matches: [],
  active: -1,
  marks: DecorationSet.empty,
  shown: DecorationSet.empty,
};

function unquote(text: string): string {
  return text.replace(/\\([nrt\\])/g, (sequence, char: string) => ESCAPES[char] ?? sequence);
}

export function findPattern(query: NoteFindQuery): RegExp | null {
  if (!query.search) return null;
  const source = query.regexp ? query.search : unquote(query.search).replace(REGEXP_SPECIALS, "\\$&");
  try {
    return new RegExp(source, query.caseSensitive ? "gmu" : "gimu");
  } catch {
    return null;
  }
}

function blockText(node: ProseMirrorNode): string {
  let text = "";
  node.forEach((child) => {
    text += child.isText ? (child.text ?? "") : ATOM.repeat(child.nodeSize);
  });
  return text;
}

function charBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const low = text.charCodeAt(index - 1);
  return low >= 0xdc00 && low <= 0xdfff && index >= 2 ? text.slice(index - 2, index) : text.charAt(index - 1);
}

function charAt(text: string, index: number): string {
  const point = text.codePointAt(index);
  return point === undefined ? "" : String.fromCodePoint(point);
}

function isWord(char: string): boolean {
  return char !== "" && WORD.test(char);
}

function wholeWordAt(text: string, from: number, to: number): boolean {
  const startsWord = !(isWord(charBefore(text, from)) && isWord(charAt(text, from)));
  const endsWord = !(isWord(charBefore(text, to)) && isWord(charAt(text, to)));
  return startsWord && endsWord;
}

function matchesIn(text: string, start: number, pattern: RegExp, query: NoteFindQuery, into: NoteFindMatch[]): void {
  pattern.lastIndex = 0;
  for (let found = pattern.exec(text); found && into.length < MAX_FIND_MATCHES; found = pattern.exec(text)) {
    const end = found.index + found[0].length;
    if (found[0].length === 0) {
      pattern.lastIndex = found.index + (charAt(text, found.index).length || 1);
      continue;
    }
    if (found[0].includes(ATOM) || (query.wholeWord && !wholeWordAt(text, found.index, end))) continue;
    into.push({ from: start + found.index, to: start + end, groups: Array.from(found, (group) => group ?? "") });
  }
}

export function findMatches(doc: ProseMirrorNode, query: NoteFindQuery): { valid: boolean; matches: NoteFindMatch[] } {
  const pattern = findPattern(query);
  if (!pattern) return { valid: query.search === "", matches: [] };
  const matches: NoteFindMatch[] = [];
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_FIND_MATCHES) return false;
    if (!node.isTextblock) return true;
    matchesIn(blockText(node), pos + 1, pattern, query, matches);
    return false;
  });
  return { valid: true, matches };
}

function firstFrom(matches: readonly NoteFindMatch[], position: number): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (matches[middle].from < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

interface Range {
  readonly from: number;
  readonly to: number;
}

type FindMeta = { readonly query: NoteFindQuery | null } | { readonly activate: number } | { readonly after: number };

function indexOf(matches: readonly NoteFindMatch[], range: Range | undefined): number {
  if (!range) return -1;
  const at = firstFrom(matches, range.from);
  const match = matches[at];
  return match && match.from === range.from && match.to === range.to ? at : -1;
}

function shownMarks(doc: ProseMirrorNode, marks: DecorationSet, matches: readonly NoteFindMatch[], active: number): DecorationSet {
  const match = matches[active];
  return match ? marks.add(doc, [Decoration.inline(match.from, match.to, { class: ACTIVE_MATCH_CLASS })]) : marks;
}

function withActive(state: NoteFindState, doc: ProseMirrorNode, active: number): NoteFindState {
  if (active === state.active) return state;
  return { ...state, active, shown: shownMarks(doc, state.marks, state.matches, active) };
}

function opened(doc: ProseMirrorNode, query: NoteFindQuery, anchor: Range | undefined): NoteFindState {
  const { valid, matches } = findMatches(doc, query);
  const marks = DecorationSet.create(
    doc,
    matches.map((match) => Decoration.inline(match.from, match.to, { class: MATCH_CLASS })),
  );
  const active = indexOf(matches, anchor);
  return { query, valid, matches, active, marks, shown: shownMarks(doc, marks, matches, active) };
}

function wrapped(matches: readonly NoteFindMatch[], index: number): number {
  if (matches.length === 0) return -1;
  return index >= 0 && index < matches.length ? index : 0;
}

function applyFind(tr: Transaction, previous: NoteFindState, state: EditorState): NoteFindState {
  const meta = tr.getMeta(noteFindKey) as FindMeta | undefined;
  const current = previous.matches[previous.active];
  if (meta && "query" in meta) {
    if (!meta.query) return CLOSED;
    return opened(state.doc, meta.query, previous.query && current ? current : state.selection);
  }
  if (!previous.query) return previous;
  if (tr.docChanged) {
    const mapped = current && { from: tr.mapping.map(current.from, 1), to: tr.mapping.map(current.to, -1) };
    const next = opened(state.doc, previous.query, mapped);
    if (!meta || !("after" in meta)) return next;
    return withActive(next, state.doc, wrapped(next.matches, firstFrom(next.matches, meta.after)));
  }
  if (meta && "activate" in meta) return withActive(previous, state.doc, meta.activate);
  if (tr.selectionSet) return withActive(previous, state.doc, indexOf(previous.matches, state.selection));
  return previous;
}

export function noteFindState(state: EditorState): NoteFindState {
  return noteFindKey.getState(state) ?? CLOSED;
}

export function setNoteFindQuery(view: EditorView, query: NoteFindQuery | null): void {
  view.dispatch(view.state.tr.setMeta(noteFindKey, { query: query?.search ? query : null }));
}

export function closeNoteFind(view: EditorView): void {
  const { query, matches, active } = noteFindState(view.state);
  if (!query) return;
  const tr = view.state.tr.setMeta(noteFindKey, { query: null });
  const match = matches[active];
  if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
  view.dispatch(tr);
}

function lastEndingBy(matches: readonly NoteFindMatch[], position: number): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (matches[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

function activate(view: EditorView, index: number): NoteFindMatch | null {
  view.dispatch(view.state.tr.setMeta(noteFindKey, { activate: index }));
  return noteFindState(view.state).matches[index] ?? null;
}

export function findNextMatch(view: EditorView): NoteFindMatch | null {
  const { matches, active } = noteFindState(view.state);
  if (matches.length === 0) return null;
  const from = matches[active]?.to ?? view.state.selection.to;
  return activate(view, wrapped(matches, firstFrom(matches, from)));
}

export function findPreviousMatch(view: EditorView): NoteFindMatch | null {
  const { matches, active } = noteFindState(view.state);
  if (matches.length === 0) return null;
  const before = lastEndingBy(matches, matches[active]?.from ?? view.state.selection.from);
  return activate(view, before >= 0 ? before : matches.length - 1);
}

function expandGroups(replace: string, groups: readonly string[]): string {
  return replace.replace(/\$([$&]|\d+)/g, (token, name: string) => {
    if (name === "&") return groups[0] ?? "";
    if (name === "$") return "$";
    for (let length = name.length; length > 0; length--) {
      const index = Number(name.slice(0, length));
      if (index > 0 && index < groups.length) return groups[index] + name.slice(length);
    }
    return token;
  });
}

export function replacementFor(query: NoteFindQuery, match: NoteFindMatch, keepCase: boolean): string {
  const text = unquote(query.replace);
  if (query.regexp) return expandGroups(text, match.groups);
  return keepCase ? preserveCase(match.groups[0] ?? "", text) : text;
}

function replaceRange(tr: Transaction, match: NoteFindMatch, text: string): void {
  if (text) tr.insertText(text, match.from, match.to);
  else tr.delete(match.from, match.to);
}

export function replaceNextMatch(view: EditorView, keepCase: boolean): NoteFindMatch | null {
  const { query, matches, active } = noteFindState(view.state);
  if (!query || !view.editable) return null;
  const current = matches[active];
  if (!current) return findNextMatch(view);
  const text = replacementFor(query, current, keepCase);
  const tr = view.state.tr;
  replaceRange(tr, current, text);
  view.dispatch(tr.setMeta(noteFindKey, { after: current.from + text.length }));
  const next = noteFindState(view.state);
  return next.matches[next.active] ?? null;
}

export function replaceAllMatches(view: EditorView, keepCase: boolean): number {
  const { query, matches } = noteFindState(view.state);
  if (!query || !view.editable || matches.length === 0) return 0;
  const tr = view.state.tr;
  for (let index = matches.length - 1; index >= 0; index--) {
    replaceRange(tr, matches[index], replacementFor(query, matches[index], keepCase));
  }
  view.dispatch(tr);
  return matches.length;
}

export const NoteFind = Extension.create({
  name: "noteFind",
  addProseMirrorPlugins() {
    return [
      new Plugin<NoteFindState>({
        key: noteFindKey,
        state: {
          init: () => CLOSED,
          apply: (tr, previous, _old, state) => applyFind(tr, previous, state),
        },
        props: {
          decorations: (state) => noteFindState(state).shown,
        },
      }),
    ];
  },
});
