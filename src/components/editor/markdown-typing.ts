import { invertedEffects } from "@codemirror/commands";
import { type EditorState, type Extension, StateEffect, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Editor, JSONContent } from "@tiptap/core";
import { Mark, type Node as ModelNode } from "@tiptap/pm/model";
import { type EditorState as ModelState, TextSelection } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import { type MarkdownSourceSnapshot, parseMarkdownBody, serializeMarkdownBody } from "@oleafly/wysiwyg";
import { reportEditorError } from "@oleafly/editor";
import { minimalReplacement } from "@oleafly/editor/CodeMirrorEditor";
import { myersEditScript } from "@/lib/myers-diff";
import { type PendingTyping, type TypedKey, heldAt, pendingAt, pendingTyping } from "@/components/editor/markdown-keymap";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";

export interface TypingModel {
  editor: Editor;
  snapshot: MarkdownSourceSnapshot | null;
  mark: string;
  clean: ModelNode;
  slice: { head: string; text: string; from: number };
}

type Model = TypingModel;
type Span = { from: number; to: number };

const SPLIT_DIFF_LIMIT = 20_000;
const RUN_LIMIT = 64;

export function parse(input: string) {
  return parseMarkdownBody(input, { preservedInlineRanges: markdownMathRanges(input) });
}

export function reported<T>(run: () => T, fallback: T, failed?: () => void): T {
  try {
    return run();
  } catch (error) {
    failed?.();
    reportEditorError("markdown toolbar", error);
    return fallback;
  }
}

function blocks(json: JSONContent): JSONContent[] {
  const content = [...(json.content ?? [])];
  while (content.length > 0 && content.at(-1)?.type === "paragraph" && !content.at(-1)?.content?.length) content.pop();
  return content;
}

function canonical(json: JSONContent): string {
  return JSON.stringify(blocks(json));
}

function readsAs(model: Model, text: string): string {
  return canonical(model.editor.schema.nodeFromJSON(parse(text).doc).toJSON());
}

function lineColumn(marked: string, mark: string, index: number, clean: string): number | null {
  const cleanLines = clean.split("\n");
  if (marked.replaceAll(mark, "").split("\n").length !== cleanLines.length) return null;
  const before = marked.slice(0, index);
  const line = before.split("\n").length - 1;
  const column = before.length - (before.lastIndexOf("\n") + 1);
  const start = cleanLines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0);
  return start + Math.min(column, cleanLines[line].length);
}

function markChoices(state: ModelState, pos: number, side: -1 | 0 | 1, prefer?: readonly Mark[]): (readonly Mark[])[] {
  const $pos = state.doc.resolve(pos);
  const natural = side < 0 ? $pos.nodeBefore?.marks : side > 0 ? $pos.nodeAfter?.marks : $pos.marks();
  const choices: (readonly Mark[])[] = [];
  for (const marks of [prefer, natural ?? [], $pos.marks(), $pos.nodeAfter?.marks, $pos.nodeBefore?.marks, []]) {
    if (!marks) continue;
    const allowed = marks.filter((mark) => $pos.parent.type.allowsMarkType(mark.type));
    if (!choices.some((each) => Mark.sameSet(each, allowed))) choices.push(allowed);
  }
  return choices;
}

export function endOffset(model: Model, state: ModelState, pos: number, side: -1 | 0 | 1, after: string, exact = false, prefer?: readonly Mark[]): number | null {
  if (!state.doc.resolve(pos).parent.inlineContent) return null;
  let nearest: number | null = null;
  for (const marks of markChoices(state, pos, side, prefer)) {
    const doc = new Transform(state.doc).insert(pos, state.schema.text(model.mark, marks)).doc;
    const marked = serializeMarkdownBody(doc.toJSON(), model.snapshot);
    const index = marked.indexOf(model.mark);
    if (index < 0 || marked.includes(model.mark, index + 1)) continue;
    if (marked.slice(0, index) + marked.slice(index + 1) === after) return index;
    if (!exact) nearest ??= lineColumn(marked, model.mark, index, after);
  }
  return nearest;
}

export function changesBetween(before: string, after: string): { from: number; to: number; insert: string }[] {
  const span = minimalReplacement(before, after);
  const removed = Array.from(before.slice(span.from, span.to));
  const added = Array.from(span.insert);
  const script = removed.length + added.length <= SPLIT_DIFF_LIMIT ? myersEditScript(removed, added) : null;
  if (!script) return [span];
  const offsets = [span.from];
  for (const char of removed) offsets.push((offsets.at(-1) ?? span.from) + char.length);
  const changes: { from: number; to: number; insert: string }[] = [];
  for (const edit of script) {
    if (edit.kind === "same") continue;
    const from = offsets[edit.oldStart];
    const to = edit.kind === "del" ? offsets[edit.oldStart + edit.length] : from;
    const insert = edit.kind === "add" ? added.slice(edit.newStart, edit.newStart + edit.length).join("") : "";
    const last = changes.at(-1);
    if (last && last.to === from) {
      last.to = to;
      last.insert += insert;
    } else changes.push({ from, to, insert });
  }
  return changes;
}

function effectiveMarks(state: ModelState): readonly Mark[] {
  return state.storedMarks ?? state.selection.$head.marks();
}

export function pendingMarks(state: EditorState): readonly Mark[] | null {
  const pending = pendingAt(state);
  const { main } = state.selection;
  return pending && main.empty && pending.from === main.head && pending.to === main.head ? pending.marks : null;
}

function openParagraph(state: ModelState): ModelState | null {
  const { $head } = state.selection;
  const paragraph = state.schema.nodes.paragraph;
  if ($head.depth < 1 || !paragraph) return null;
  const after = $head.after(1);
  const tr = state.tr.insert(after, paragraph.create());
  return state.apply(tr.setSelection(TextSelection.create(tr.doc, after + 1)).setStoredMarks(effectiveMarks(state)));
}

function viewed(model: Model, state: ModelState, run: (view: Editor["view"]) => boolean): ModelState | null {
  const { editor } = model;
  if (editor.isDestroyed) return null;
  const saved = editor.state;
  try {
    editor.view.updateState(state);
    return run(editor.view) ? editor.state : null;
  } finally {
    editor.view.updateState(saved);
  }
}

function keyed(model: Model, start: ModelState, key: TypedKey, prefix: string): ModelState | null {
  const state = prefix.includes("\n") ? openParagraph(start) : start;
  if (!state) return null;
  const typed = prefix.includes("\n") ? key.text : prefix + key.text;
  return viewed(model, state, (view) => {
    const { from, to, $from } = view.state.selection;
    if (key.kind === "paste") {
      if (typed.includes("\n")) return false;
      view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(typed, $from.marks()), false));
    } else if (key.kind === "cut") view.dispatch(view.state.tr.deleteSelection());
    else if (!typed) return !!view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key: "Backspace" })));
    else {
      if (!view.someProp("handleTextInput", (handle) => handle(view, from, to, typed, () => view.state.tr.insertText(typed, from, to)))) {
        view.dispatch(view.state.tr.insertText(typed, from, to));
      }
      const back = key.text.length - (key.head - key.from);
      if (back > 0) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.head - back)));
    }
    return true;
  });
}

function entered(model: Model, state: ModelState, extra: number, target: string | null): ModelState | null {
  const split = viewed(model, state, (view) => {
    if (!view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key: "Enter" })))) return false;
    const { head } = view.state.selection;
    if (extra > 0 && view.state.doc.textBetween(head, Math.min(head + extra, view.state.doc.content.size)).trim() === "") {
      view.dispatch(view.state.tr.delete(head, head + extra).setStoredMarks(view.state.storedMarks));
    }
    return true;
  });
  if (target === null || (split && canonical(split.doc.toJSON()) === target)) return split;
  const { head } = state.selection;
  if (!state.selection.empty || state.doc.textBetween(head, Math.min(head + extra, state.doc.content.size)).trim() !== "") return null;
  const tr = state.tr.insertText(" ", head, head + extra).removeMark(head, head + 1);
  const soft = state.apply(tr.setSelection(TextSelection.create(tr.doc, head + 1)).setStoredMarks(effectiveMarks(state)));
  return canonical(soft.doc.toJSON()) === target ? soft : null;
}

interface Flat {
  text: string;
  marked: string | null;
}

function flat(model: Model, state: ModelState, prefer?: readonly Mark[]): Flat {
  const text = serializeMarkdownBody(state.doc.toJSON(), null);
  const { selection } = state;
  if (!selection.empty || !selection.$head.parent.inlineContent) return { text, marked: null };
  let marked: string | null = null;
  for (const marks of markChoices(state, selection.head, 0, prefer)) {
    const out = serializeMarkdownBody(new Transform(state.doc).insert(selection.head, state.schema.text(model.mark, marks)).doc.toJSON(), null);
    const index = out.indexOf(model.mark);
    if (index < 0 || out.includes(model.mark, index + 1)) continue;
    if (out.slice(0, index) + out.slice(index + 1) === text) return { text, marked: out };
    marked ??= out;
  }
  return { text, marked };
}

const FENCE = /^ {0,3}(?:`{3,}|~{3,}|:{3,})/gmu;

function fences(text: string): string {
  return (text.match(FENCE) ?? []).map((fence) => fence.trim()[0]).join("");
}

const MARKUP_TAGS = /<\/?[a-z][^<>\n]*>/giu;
const FENCE_LINES = /^[ \t>]*(?:`{3,}|~{3,}|:{3,})[^\n]*(?:\n|$)/gmu;
const LIST_MARKER = /^([ \t>]*)([*+-]|\d{1,9}[.)])(?=[ \t]|$)/gmu;
const LIST_TOKENS: Readonly<Record<string, string>> = { "*": "\u0001", "-": "\u0002", "+": "\u0003" };
const MARKUP_CHARS = /[*_~`^=\\#|+>[\]{}\t -]/gu;

/**
 * The words of a Markdown text with its markup taken out: delimiters, tags, fence lines, heading marks and spacing
 * go; line breaks (collapsed) and list markers stay, so a key that hops to another line or rewrites another item's
 * marker reads as a different text.
 */
function withoutTags(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(MARKUP_TAGS, "");
  } while (current !== previous);
  return current;
}

export function wordsOf(text: string): string {
  return withoutTags(text)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(FENCE_LINES, "\n")
    .replace(LIST_MARKER, (_all, lead: string, marker: string) => `${lead}${LIST_TOKENS[marker] ?? `\u0004${marker}`}`)
    .replace(MARKUP_CHARS, "")
    .replace(/\n+/gu, "\n")
    .replace(/^\n|\n$/gu, "");
}

const DEFINITION_LEAD = /^ {0,3}\[\^?[^\]\n]+\]:[ \t]*/u;
const CLOSING_RUN = /^(?:\*\*|__|~~|\*|_|`+|<\/[a-z]+>)/u;

function openerOf(closer: string): string {
  return closer.startsWith("</") ? `<${closer.slice(2, -1)}` : closer;
}

function count(text: string, part: string): number {
  return part ? text.split(part).length - 1 : 0;
}

/**
 * Moves a selection's ends off half a construct: out of a definition's `[^id]: ` lead to the line start, and over a
 * closing delimiter whose opener the selection holds, so the next key replaces whole markup, never half of it.
 */
export function settledEnds(text: string, from: number, to: number): [number, number] {
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  const lead = DEFINITION_LEAD.exec(text.slice(lineStart));
  if (lead && from > lineStart && from < lineStart + lead[0].length) from = lineStart;
  const closer = CLOSING_RUN.exec(text.slice(to))?.[0];
  if (closer) {
    const inside = text.slice(from, to);
    const opener = openerOf(closer);
    const unmatched = opener === closer ? count(inside, closer) % 2 === 1 : count(inside, opener) > count(inside, closer);
    if (unmatched) to += closer.length;
  }
  return [from, to];
}

function insertsOnly(before: string, after: string, span: Span): boolean {
  const old = Array.from(before);
  const made = Array.from(after);
  const script = old.length + made.length <= SPLIT_DIFF_LIMIT ? myersEditScript(old, made) : null;
  if (!script) return false;
  const offsets = [0];
  for (const char of old) offsets.push((offsets.at(-1) ?? 0) + char.length);
  return script.every((edit) => edit.kind !== "del" || (offsets[edit.oldStart] >= span.from && offsets[edit.oldStart + edit.length] <= span.to));
}

const DEFINITION = /(?:^|\n) {0,3}\[(?!\^)[^\]\n]+\]:/u;
const DEFINITIONS = /^ {0,3}\[(?!\^)[^\]\n]+\]:.*$/gmu;

function keeps(plain: string, text: string): boolean {
  const left = new Set(text.match(DEFINITIONS) ?? []);
  return (plain.match(DEFINITIONS) ?? []).every((line) => left.has(line));
}

function masked(base: string, target: string, own: Span): string | null {
  const old = Array.from(base);
  const made = Array.from(target);
  const script = old.length + made.length <= SPLIT_DIFF_LIMIT ? myersEditScript(old, made) : null;
  if (!script) return null;
  const offsets = [0];
  for (const char of old) offsets.push((offsets.at(-1) ?? 0) + char.length);
  let out = "";
  let hunk: { from: number; to: number; removed: string; added: string } | null = null;
  const flush = () => {
    if (hunk) out += hunk.from === hunk.to || (hunk.from >= own.from && hunk.to <= own.to && !DEFINITION.test(hunk.removed)) ? hunk.added : hunk.removed;
    hunk = null;
  };
  for (const edit of script) {
    if (edit.kind === "same") {
      flush();
      out += old.slice(edit.oldStart, edit.oldStart + edit.length).join("");
      continue;
    }
    const at = offsets[edit.oldStart];
    hunk ??= { from: at, to: at, removed: "", added: "" };
    if (edit.kind === "del") {
      hunk.to = offsets[edit.oldStart + edit.length];
      hunk.removed += old.slice(edit.oldStart, edit.oldStart + edit.length).join("");
    } else hunk.added += made.slice(edit.newStart, edit.newStart + edit.length).join("");
  }
  flush();
  return out;
}

function rebased(before: string, after: string, source: string): string | null {
  const old = Array.from(before);
  const own = Array.from(source);
  const made = Array.from(after);
  if (old.length + Math.max(own.length, made.length) > SPLIT_DIFF_LIMIT) return null;
  const align = myersEditScript(old, own);
  const delta = myersEditScript(old, made);
  if (!align || !delta) return null;
  const map: number[] = new Array(old.length + 1).fill(-1);
  for (const edit of align) {
    if (edit.kind === "same") for (let step = 0; step < edit.length; step += 1) map[edit.oldStart + step] = edit.newStart + step;
    else if (map[edit.oldStart] < 0) map[edit.oldStart] = edit.newStart;
  }
  map[old.length] = own.length;
  for (let point = 1; point < map.length; point += 1) if (map[point] < 0) map[point] = map[point - 1];
  let out = "";
  let at = 0;
  for (const edit of delta) {
    if (edit.kind === "same") continue;
    const start = map[edit.oldStart];
    const end = edit.kind === "del" ? map[edit.oldStart + edit.length] : start;
    if (start < at || end < start) return null;
    out += own.slice(at, start).join("") + (edit.kind === "add" ? made.slice(edit.newStart, edit.newStart + edit.length).join("") : "");
    at = end;
  }
  return out + own.slice(at).join("");
}

function around(before: string, after: string, source: string, mark: string): string | null {
  const [old, made, own] = [before, after, source].map((text) => [text.slice(0, text.indexOf(mark)), text.slice(text.indexOf(mark) + mark.length)]);
  const start = rebased(old[0], made[0], own[0]);
  const end = rebased(old[1], made[1], own[1]);
  return start === null || end === null ? null : start + mark + end;
}

interface Run {
  model: Model;
  state: ModelState;
  from: number;
  body: string;
  range: Span;
  region: Span;
  count: number;
  prefix: string;
  known: Flat | null;
  closer: string;
  spot: number | null;
  idle: boolean;
}

function carry(run: Run, state: ModelState, body: string, caret: number, region: Span, closer: string, known: Flat | null = null) {
  return pendingTyping.of(pendingFor({ ...run, state, body, range: { from: caret, to: caret }, region, count: run.count + 1, prefix: "", known, closer, spot: null, idle: false }));
}

function skipped(run: Run, key: TypedKey): ModelState | null {
  const { state } = run;
  const { head } = state.selection;
  if (key.kind !== "type" || !run.closer.startsWith(key.text) || state.doc.textBetween(head, Math.min(head + key.text.length, state.doc.content.size)) !== key.text) return null;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, head + key.text.length)));
}

function handedKey(run: Run, key: TypedKey): TransactionSpec | null {
  const { model, state, from, body, range, region, count, prefix, known, spot } = run;
  const extra = body.slice(range.to - from, key.to - from);
  if (key.from !== range.from || key.to < range.to || (extra && (key.kind !== "enter" || extra.trim() !== ""))) return null;
  const at = range.from - from;
  const end = key.to - from;
  const plain = body.slice(0, at) + key.text + body.slice(end);
  if (key.doc.sliceString(from, from + plain.length) !== plain) return null;
  const bare = range.from === range.to;
  const skip = skipped(run, key);
  const next =
    skip ??
    (key.kind === "enter"
      ? key.text.includes("\n")
        ? entered(model, state, extra.length, bare ? readsAs(model, model.slice.head + plain) : null)
        : null
      : keyed(model, state, key, prefix));
  if (!next) return null;
  const caret = key.head - from;
  if (key.kind === "enter" && bare) return { effects: carry(run, next, plain, key.head, { from: caret, to: caret }, "") };
  const before = known ?? flat(model, state);
  const cut = spot === null ? { from: at - prefix.length, to: at } : { from: spot, to: spot };
  const own = { from: Math.min(region.from, cut.from), to: Math.max(region.to, range.to - from, cut.to) };
  const grow = key.text.length - (end - at);
  const typed = { from: Math.min(own.from, at), to: Math.max(own.to >= end ? own.to + grow : at + key.text.length, at + key.text.length) };
  const context: Context = { body, plain, bare, before, own, cut, typed };
  let result = placedText(model, next, context);
  const unlinked = !result.local && bare && key.kind === "type" ? withoutLink(next, (prefix.includes("\n") ? "" : prefix).length + key.text.length) : null;
  if (unlinked) {
    const plainMarks = state.selection.$head.marks().filter((each) => each.type !== state.schema.marks.link);
    const retry = placedText(model, unlinked, { ...context, before: flat(model, state, plainMarks) });
    if (retry.local) result = retry;
  }
  const { local, after, state: carried } = result;
  const text = local?.text ?? plain;
  // Visual's reading of a key may add or mend markup around it, but the words must stay what plain typing gives:
  // the key lands among the same letters, and no definition, link target or math moves. Otherwise it types plainly.
  if (key.kind === "type" && text !== plain && wordsOf(text) !== wordsOf(plain)) return null;
  const placed = local?.caret ?? caret;
  const closer = skip ? run.closer.slice(key.text.length) : key.kind === "type" ? key.text.slice(key.head - key.from) + run.closer : "";
  const more = !run.idle && count + 1 < RUN_LIMIT && (closer !== "" || !(text === plain && local?.exact));
  if (text === plain && !more) return null;
  const span = minimalReplacement(body, text);
  const grown = { from: Math.min(own.from, span.from), to: Math.max(span.from + span.insert.length, own.to + text.length - body.length) };
  return {
    changes: changesBetween(plain, text).map((change) => ({ ...change, from: from + change.from, to: from + change.to })),
    selection: { anchor: from + placed },
    effects: more ? carry(run, carried, text, from + placed, grown, closer, after) : [],
    scrollIntoView: true,
  };
}

interface Context {
  body: string;
  plain: string;
  bare: boolean;
  before: Flat;
  own: Span;
  cut: Span;
  typed: Span;
}

function withoutLink(state: ModelState, size: number): ModelState | null {
  const link = state.schema.marks.link;
  const { head } = state.selection;
  if (!link || !state.selection.empty || head < size || !state.doc.rangeHasMark(head - size, head, link)) return null;
  return state.apply(state.tr.removeMark(head - size, head, link));
}

function placedText(model: Model, next: ModelState, context: Context): { local: { text: string; caret: number; exact: boolean } | null; after: Flat; state: ModelState } {
  const { body, plain, bare, before, own, cut, typed } = context;
  const { head } = model.slice;
  const { mark } = model;
  const after = flat(model, next);
  const tail = `\n\n${mark}`;
  const ending = blocks(model.editor.schema.nodeFromJSON(parse(mark).doc).toJSON());
  const want = JSON.stringify([...blocks(next.doc.toJSON()), ...ending]);
  let shown: string | null = null;
  const visual = () => (shown ??= serializeMarkdownBody(next.doc.toJSON(), model.snapshot));
  let shownReads: string | null = null;
  const reading = (text: string): "exact" | "shown" | null => {
    const reads = readsAs(model, head + text + tail);
    if (reads === want) return "exact";
    shownReads ??= readsAs(model, visual() + tail);
    return reads === shownReads ? "shown" : null;
  };
  let loose: boolean | null = null;
  for (const anchored of bare && before.marked ? [true, false] : [false]) {
    if (!after.marked || body.includes(mark)) break;
    const source = `${head}${body.slice(0, cut.from)}${anchored ? mark : ""}${body.slice(cut.to)}`;
    const moved = anchored && before.marked ? around(before.marked, after.marked, source, mark) : rebased(before.text, after.marked, source);
    const index = moved?.startsWith(head) ? moved.indexOf(mark) : -1;
    if (!moved || index < 0 || moved.includes(mark, index + 1)) continue;
    const text = (moved.slice(0, index) + moved.slice(index + mark.length)).slice(head.length);
    loose ??= model.editor.schema.nodeFromJSON(parse(head + plain).doc).textContent !== next.doc.textContent;
    if (!loose && !insertsOnly(body, text, own)) continue;
    const how = keeps(plain, text) ? reading(text) : null;
    if (how) return { local: { text, caret: index - head.length, exact: how === "exact" }, after, state: next };
  }
  const spot = visual().startsWith(head) && !body.includes(mark) ? endOffset(model, next, next.selection.head, 0, visual(), true) : null;
  if (spot !== null && spot >= head.length && (fences(plain) !== fences(body) || reading(plain) === null)) {
    const shown = visual();
    const moved = masked(plain, shown.slice(head.length, spot) + mark + shown.slice(spot), typed);
    const index = moved?.indexOf(mark) ?? -1;
    const text = moved && index >= 0 ? moved.slice(0, index) + moved.slice(index + mark.length) : null;
    const how = text !== null && text !== plain && keeps(plain, text) ? reading(text) : null;
    if (text !== null && how) return { local: { text, caret: index, exact: how === "exact" }, after, state: next };
  }
  return { local: null, after, state: next };
}

function pendingFor(run: Run): PendingTyping {
  return {
    from: run.range.from,
    to: run.range.to,
    idle: run.idle,
    marks: effectiveMarks(run.state),
    replace: (key) => reported(() => handedKey(run, key), null),
  };
}

function started(model: Model, state: ModelState, from: number, body: string, range: Span, region: Span, prefix = "", spot: number | null = null, idle = false) {
  return pendingTyping.of(pendingFor({ model, state, from, body, range, region, count: 0, prefix, known: null, closer: "", spot, idle }));
}

export function typingAfter(model: Model, typed: ModelState, start: number, body: string, range: Span, idle = false) {
  const lead = "\n".repeat(Math.max(0, start - model.slice.from));
  const span = minimalReplacement(model.slice.text, lead + body);
  const picked = { from: range.from - start, to: range.to - start };
  const changed = model.slice.text !== lead + body;
  const region = changed
    ? { from: Math.min(picked.from, Math.max(0, span.from - lead.length)), to: Math.max(picked.to, span.from + span.insert.length - lead.length) }
    : picked;
  return started(model, typed, start, body, range, region, "", null, idle);
}

export function bareCaret(model: Model, state: EditorState, start: number, body: string, at: { position: number; offset: number }): TransactionSpec | null {
  const caret = state.selection.main.head;
  const typed = model.editor.state;
  if (!typed.selection.empty || typed.selection.head !== at.position) return null;
  const before = pendingMarks(state) ?? model.clean.resolve(Math.min(at.position, model.clean.content.size)).marks();
  const idle = Mark.sameSet(before, effectiveMarks(typed));
  const [low, high] = [Math.min(at.offset, caret), Math.max(at.offset, caret)];
  const skipped = state.doc.sliceString(low, high);
  const blank = skipped.trim() === "";
  const tail = state.doc.sliceString(start + body.length, Math.max(caret, start + body.length));
  const range = { from: caret, to: caret };
  const region = { from: low - start, to: high - start };
  if (blank && at.offset <= caret && !(idle && skipped.includes("\n"))) return { effects: started(model, typed, start, body + tail, range, region, skipped, null, idle) };
  return idle && !blank ? { effects: started(model, typed, start, body + tail, range, region, "", at.offset - start, true) } : null;
}

function finishComposition(view: EditorView) {
  const pending = heldAt(view.state);
  if (!pending || pending.composed === undefined || view.composing) return;
  const { doc, selection } = view.state;
  const spec = pending.replace({ from: pending.from, to: pending.to, text: doc.sliceString(pending.from, pending.composed), head: selection.main.head, kind: "type", doc });
  view.dispatch(spec ? { ...spec, userEvent: "input.type" } : {});
}

const undoneAt = StateEffect.define<number>({ map: (value, mapping) => mapping.mapPos(value, 1) });

export const handoffExtras: Extension = [
  EditorView.domEventHandlers({ compositionend: (_event, view) => void setTimeout(() => finishComposition(view), 0) }),
  invertedEffects.of((tr) => (tr.isUserEvent("undo") && tr.startState.selection.main.empty ? [undoneAt.of(tr.startState.selection.main.head)] : [])),
  EditorView.updateListener.of((update) => {
    for (const tr of update.transactions) {
      for (const effect of tr.isUserEvent("redo") ? tr.effects : []) {
        if (!effect.is(undoneAt) || effect.value === tr.newSelection.main.head) continue;
        tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
          if (fromB <= effect.value && effect.value <= toB) queueMicrotask(() => update.view.dispatch({ selection: { anchor: effect.value } }));
        });
      }
    }
  }),
];
