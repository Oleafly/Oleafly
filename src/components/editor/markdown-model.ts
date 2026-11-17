import { isolateHistory } from "@codemirror/commands";
import { type ChangeSet, EditorSelection, type EditorState, type SelectionRange, type Text, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import type { Mark, Node as ModelNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import {
  WYSIWYG_EXTENSIONS,
  createMarkdownSourceSnapshot,
  type MarkdownSourceSnapshot,
  type MarkdownUnits,
  markdownUnits,
  parseMarkdownBody,
  serializeMarkdownBody,
} from "@oleafly/wysiwyg";
import { readableLinkHref } from "@oleafly/wysiwyg/link-destination";
import type { TextAlign } from "@oleafly/wysiwyg/text-align-values";
import { reportEditorError } from "@oleafly/editor";
import { minimalReplacement } from "@oleafly/editor/CodeMirrorEditor";
import { myersEditScript } from "@/lib/myers-diff";
import { visualLinkHref } from "@/components/editor/markdown-commands";
import { pendingTyping } from "@/components/editor/markdown-keymap";
import { alignmentOf, alignText, applyTextColor, clearFormatting, textColorOf } from "@/components/editor/rich-text-controls";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";

export interface MarkdownToolbarState {
  align: TextAlign;
  textColor: string | null;
  link: boolean;
  aligns: boolean;
  heading: number | null;
}

export interface MarkdownTarget {
  bold(): void;
  italic(): void;
  strike(): void;
  code(): void;
  underline(): void;
  highlight(): void;
  superscript(): void;
  subscript(): void;
  heading(level: number): void;
  paragraph(): void;
  codeBlock(): void;
  bullet(): void;
  ordered(): void;
  quote(): void;
  align(value: TextAlign): void;
  clear(): void;
  color(spec: string | null): void;
  emoji(text: string): void;
  link(typed: string): void;
  unlink(): void;
  linkHref(): string;
  image(typed: string): void;
  table(): void;
}

export const RESTING_STATE: MarkdownToolbarState = { align: "left", textColor: null, link: false, aligns: true, heading: null };

export const IDLE_TARGET = new Proxy({}, { get: () => () => "" }) as MarkdownTarget;

export function visualStateOf(editor: Editor | null): MarkdownToolbarState | null {
  if (!editor || editor.isDestroyed) return null;
  return {
    align: alignmentOf(editor),
    textColor: textColorOf(editor),
    link: editor.isActive("link"),
    aligns: !editor.isActive("table") && !editor.isActive("codeBlock"),
    heading: editor.isActive("heading") ? Number(editor.getAttributes("heading").level) : null,
  };
}

export function sameToolbarState(left: MarkdownToolbarState | null, right: MarkdownToolbarState | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.align === right.align &&
    left.textColor === right.textColor &&
    left.link === right.link &&
    left.aligns === right.aligns &&
    left.heading === right.heading
  );
}

export function visualTarget(editor: Editor): MarkdownTarget {
  const chain = () => editor.chain().focus();
  return {
    bold: () => chain().toggleBold().run(),
    italic: () => chain().toggleItalic().run(),
    strike: () => chain().toggleStrike().run(),
    code: () => chain().toggleCode().run(),
    underline: () => chain().toggleUnderline().run(),
    highlight: () => chain().toggleMark("highlight").run(),
    superscript: () => chain().toggleMark("superscript").run(),
    subscript: () => chain().toggleMark("subscript").run(),
    heading: (level) => chain().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run(),
    paragraph: () => chain().setParagraph().run(),
    codeBlock: () => chain().toggleCodeBlock().run(),
    bullet: () => chain().toggleBulletList().run(),
    ordered: () => chain().toggleOrderedList().run(),
    quote: () => chain().toggleBlockquote().run(),
    align: (value) => alignText(editor, value),
    clear: () => clearFormatting(editor),
    color: (spec) => applyTextColor(editor, spec),
    emoji: (text) => chain().insertContent(text).run(),
    link: (typed) => {
      const href = visualLinkHref(typed.trim());
      if (!href) chain().extendMarkRange("link").unsetLink().run();
      else if (editor.state.selection.empty && !editor.isActive("link")) {
        chain().insertContent({ type: "text", text: "link text", marks: [{ type: "link", attrs: { href } }] }).run();
      } else chain().extendMarkRange("link").setLink({ href }).run();
    },
    unlink: () => chain().extendMarkRange("link").unsetLink().run(),
    linkHref: () => {
      const href: unknown = editor.getAttributes("link").href;
      return typeof href === "string" ? readableLinkHref(href) : "";
    },
    image: (typed) => {
      const path = typed.trim();
      if (path) chain().setImage({ src: visualLinkHref(path), alt: "" }).run();
    },
    table: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  };
}

const SNAP_STEPS = 12;
const SPLIT_DIFF_LIMIT = 20_000;
const LEADING_RULE = /^ {0,3}---[ \t]*(?:\r?\n|$)/u;

interface Slice {
  from: number;
  to: number;
  text: string;
  head: string;
  lead: string;
  units: readonly { from: number; to: number }[];
}

interface Model {
  editor: Editor;
  doc: Text;
  mark: string;
  clean: ModelNode;
  cleanJson: string;
  snapshot: MarkdownSourceSnapshot | null;
  input: string;
  positions: Map<number, number | null>;
  slice: Slice;
}

const unitsOfDoc = new WeakMap<Text, MarkdownUnits>();
let scratchEditor: Editor | null = null;
let loaded: Omit<Model, "doc" | "slice"> | null = null;
let loadedInput: string | null = null;

function unitsOf(doc: Text, source: string): MarkdownUnits {
  let units = unitsOfDoc.get(doc);
  if (!units) {
    units = markdownUnits(source, { preservedInlineRanges: markdownMathRanges(source) });
    unitsOfDoc.set(doc, units);
  }
  return units;
}

function headOf(references: MarkdownUnits["references"], text: string): string {
  if (references.size === 0) return "";
  const folded = text.replace(/\s+/gu, " ").toLowerCase().toUpperCase();
  const lines: string[] = [];
  for (const [label, { href, title }] of references) {
    if (folded.includes(label)) lines.push(`[${label}]: <${href}>${title ? ` "${title.replace(/["\\]/gu, "\\$&")}"` : ""}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

function sliceOf(doc: Text, source: string, from: number, to: number, margin: number): Slice {
  const { bodyFrom, spans, references } = unitsOf(doc, source);
  if (spans.length === 0) {
    const body = source.slice(bodyFrom);
    if (body.trim() !== "") return { from: bodyFrom, to: source.length, text: body, head: headOf(references, body), lead: "", units: [{ from: bodyFrom, to: source.length }] };
    const gap = Math.min(2, (/\n*$/u.exec(source.slice(0, bodyFrom))?.[0] ?? "").length);
    return { from: source.length, to: source.length, text: "", head: "", lead: bodyFrom > 0 ? "\n\n".slice(gap) : "", units: [{ from: source.length, to: source.length }] };
  }
  const unitOf = (offset: number, before: boolean) => {
    let index = 0;
    for (const [at, span] of spans.entries()) if (before ? span.from < offset : span.from <= offset) index = at;
    return index;
  };
  const picked = unitOf(from, false);
  let first = Math.max(0, picked - margin);
  while (first < picked && LEADING_RULE.test(source.slice(spans[first].from, spans[first].to))) first += 1;
  const last = Math.min(spans.length - 1, unitOf(to, to > from) + margin);
  const text = source.slice(spans[first].from, spans[last].to);
  return { from: spans[first].from, to: spans[last].to, text, head: headOf(references, text), lead: "", units: spans.slice(first, last + 1) };
}

function parse(input: string) {
  return parseMarkdownBody(input, { preservedInlineRanges: markdownMathRanges(input) });
}

function sentinelFor(input: string): string {
  let code = 0xe000;
  while (input.includes(String.fromCharCode(code))) code += 1;
  return String.fromCharCode(code);
}

function stripped(json: string, mark: string): string {
  const percent = encodeURIComponent(mark);
  return [mark, percent, percent.toLowerCase()].reduce((text, form) => text.replaceAll(form, ""), json);
}

function loadModel(input: string): Omit<Model, "doc" | "slice"> | null {
  const parsed = parse(input);
  if (parsed.frontmatter) return null;
  scratchEditor ??= new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS });
  const editor = scratchEditor;
  editor.chain().setMeta("addToHistory", false).setContent(parsed.doc, { emitUpdate: false }).run();
  const json = editor.getJSON();
  const snapshot = createMarkdownSourceSnapshot(parsed.layout, json);
  if (serializeMarkdownBody(json, snapshot) !== input) return null;
  const clean = editor.schema.nodeFromJSON(parsed.doc);
  const { doc } = editor.state;
  if (clean.childCount > doc.childCount || clean.content.content.some((node, index) => !node.eq(doc.child(index)))) return null;
  return { editor, mark: sentinelFor(input), clean, cleanJson: JSON.stringify(clean.toJSON()), snapshot, input, positions: new Map() };
}

function modelOf(state: EditorState, from: number, to: number, margin: number): Model | null {
  const source = state.doc.toString();
  const slice = sliceOf(state.doc, source, from, to, margin);
  const input = slice.head + slice.text;
  if (loadedInput !== input) {
    loaded = loadModel(input);
    loadedInput = loaded ? input : null;
  }
  return loaded && { ...loaded, doc: state.doc, slice };
}

function sentinels(doc: ModelNode, mark: string): number[] {
  const found: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (let at = node.text.indexOf(mark); at >= 0; at = node.text.indexOf(mark, at + 1)) found.push(pos + at);
  });
  return found;
}

function markRun(doc: ModelNode, pos: number, carrier: Mark): [number, number] {
  const $pos = doc.resolve(pos);
  const { parent } = $pos;
  let first = $pos.index();
  let start = pos - $pos.textOffset;
  while (first > 0 && carrier.isInSet(parent.child(first - 1).marks)) {
    first -= 1;
    start -= parent.child(first).nodeSize;
  }
  let end = start;
  for (let index = first; index < parent.childCount && carrier.isInSet(parent.child(index).marks); index += 1) end += parent.child(index).nodeSize;
  return [start, end];
}

function attributePosition(doc: ModelNode, clean: ModelNode): number | null {
  if (doc.content.size !== clean.content.size) return null;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    const other = clean.nodeAt(pos);
    if (!other || other.type !== node.type) found = -1;
    else if (node.isText) {
      const carrier = node.marks.find((mark) => !mark.isInSet(other.marks));
      if (carrier) found = carrier.type.name === "link" ? markRun(doc, pos, carrier)[1] : pos;
    } else if (node.sameMarkup(other)) return true;
    else if (node.isTextblock) found = pos + 1;
    else if (node.isAtom) found = node.isInline ? pos + node.nodeSize : -1;
    else return true;
    return false;
  });
  return found !== null && found >= 0 ? found : null;
}

function withCleanMarks(doc: ModelNode, clean: ModelNode, pos: number): ModelNode | null {
  if (doc.content.size !== clean.content.size) return null;
  const tr = new Transform(doc);
  doc.nodesBetween(Math.max(0, pos - 1), Math.min(doc.content.size, pos + 1), (node, at) => {
    const other = clean.nodeAt(at);
    if (!node.isText || !other?.isText) return !node.isText;
    for (const mark of node.marks) {
      const twin = other.marks.find((each) => each.type === mark.type);
      if (!twin || mark.isInSet(other.marks)) continue;
      const [start, end] = markRun(doc, at, mark);
      tr.removeMark(start, end, mark).addMark(start, end, twin);
    }
    return false;
  });
  return tr.docChanged ? tr.doc : null;
}

function matches(doc: ModelNode, model: Model, mark = model.mark): boolean {
  return stripped(JSON.stringify(doc.toJSON()), mark) === model.cleanJson;
}

function exactPosition(model: Model, offset: number): number | null {
  if (!model.positions.has(offset)) model.positions.set(offset, positionAt(model, offset));
  return model.positions.get(offset) ?? null;
}

const PUNCTUATION_MARKS = ["\u2E3A", "\u2E3B", "\u2E50", "\u2E51"];

function positionAt(model: Model, offset: number): number | null {
  const punctuation = PUNCTUATION_MARKS.find((mark) => !model.input.includes(mark));
  return positionWith(model, offset, model.mark) ?? (punctuation ? positionWith(model, offset, punctuation) : null);
}

function positionWith(model: Model, offset: number, mark: string): number | null {
  const { input } = model;
  const at = model.slice.head.length + offset;
  const marked = parse(`${input.slice(0, at)}${mark}${input.slice(at)}`);
  if (marked.frontmatter) return null;
  const doc = model.editor.schema.nodeFromJSON(marked.doc);
  const found = sentinels(doc, mark);
  if (found.length > 1) return null;
  const position = found.length === 1 ? found[0] : attributePosition(doc, model.clean);
  if (position === null) return null;
  const back = found.length === 1 ? new Transform(doc).delete(position, position + mark.length).doc : doc;
  if (matches(back, model, mark)) return position;
  const relaxed = withCleanMarks(back, model.clean, position);
  return relaxed && matches(relaxed, model, mark) ? position : null;
}

function blockAround(model: Model, sourceOffset: number): { from: number; to: number } | null {
  const { slice, doc } = model;
  const own = slice.units.find((unit) => unit.from <= sourceOffset && sourceOffset <= unit.to);
  if (own) return own;
  const line = doc.lineAt(Math.max(0, Math.min(doc.length, sourceOffset)));
  if (line.text.trim() !== "") return null;
  const before = slice.units.filter((unit) => unit.to <= sourceOffset).at(-1);
  const after = slice.units.find((unit) => unit.from >= sourceOffset);
  if (before) return { from: before.to, to: before.to };
  return after ? { from: after.from, to: after.from } : null;
}

const textless = new Map<string, boolean>();

function holdsText(model: Model, block: { from: number; to: number }): boolean {
  const text = model.doc.sliceString(block.from, block.to);
  let known = textless.get(text);
  if (known === undefined) {
    known = !JSON.stringify(parse(text).doc.content ?? []).includes('"text"') && !/[$`]/u.test(text);
    if (textless.size > 256) textless.clear();
    textless.set(text, known);
  }
  return !known;
}

function placed(model: Model, sourceOffset: number): { position: number; offset: number } | null {
  const { slice } = model;
  const block = blockAround(model, sourceOffset);
  if (!block || (block.to > block.from && !holdsText(model, block))) return null;
  const low = block.from - slice.from;
  const high = block.to - slice.from;
  const offset = Math.max(low, Math.min(high, sourceOffset - slice.from));
  const line = model.doc.lineAt(slice.from + offset);
  const sameLine = (candidate: number) => candidate >= line.from - slice.from && candidate <= line.to - slice.from;
  for (const onLine of [true, false]) {
    for (let step = 0; step <= SNAP_STEPS; step += 1) {
      for (const candidate of step === 0 ? [offset] : [offset - step, offset + step]) {
        if (candidate < low || candidate > high || sameLine(candidate) !== onLine) continue;
        const position = exactPosition(model, candidate);
        if (position !== null) return { position, offset: slice.from + candidate };
      }
    }
  }
  return null;
}

function modelPosition(model: Model, sourceOffset: number): number | null {
  return placed(model, sourceOffset)?.position ?? null;
}

type ModelState = Editor["state"];

const BLANK = /[ \t\u00a0]/u;

function select(model: Model, anchor: number, head: number) {
  const { editor } = model;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
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

function markChoices(state: ModelState, pos: number, side: -1 | 0 | 1): (readonly Mark[])[] {
  const $pos = state.doc.resolve(pos);
  const natural = side < 0 ? $pos.nodeBefore?.marks : side > 0 ? $pos.nodeAfter?.marks : $pos.marks();
  const choices: (readonly Mark[])[] = [];
  for (const marks of [natural, $pos.marks(), $pos.nodeAfter?.marks, $pos.nodeBefore?.marks, []]) {
    const allowed = (marks ?? []).filter((mark) => $pos.parent.type.allowsMarkType(mark.type));
    if (!choices.some((each) => each.length === allowed.length && each.every((mark, index) => mark.eq(allowed[index])))) choices.push(allowed);
  }
  return choices;
}

function endOffset(model: Model, state: ModelState, pos: number, side: -1 | 0 | 1, after: string): number | null {
  if (!state.doc.resolve(pos).parent.inlineContent) return null;
  let nearest: number | null = null;
  for (const marks of markChoices(state, pos, side)) {
    const doc = new Transform(state.doc).insert(pos, state.schema.text(model.mark, marks)).doc;
    const marked = serializeMarkdownBody(doc.toJSON(), model.snapshot);
    const index = marked.indexOf(model.mark);
    if (index < 0 || marked.includes(model.mark, index + 1)) continue;
    if (marked.slice(0, index) + marked.slice(index + 1) === after) return index;
    nearest ??= lineColumn(marked, model.mark, index, after);
  }
  return nearest;
}

function nodeRange(model: Model, state: ModelState, after: string): { anchor: number; head: number } | null {
  const { from, to } = state.selection;
  const without = serializeMarkdownBody(new Transform(state.doc).delete(from, to).doc.toJSON(), model.snapshot);
  const span = minimalReplacement(without, after);
  let start = span.from;
  let end = span.from + span.insert.length;
  while (start < end && /\s/u.test(after[start])) start += 1;
  while (end > start && /\s/u.test(after[end - 1])) end -= 1;
  return start < end ? { anchor: start, head: end } : null;
}

function sourceSelection(model: Model, state: ModelState, after: string): { anchor: number; head: number } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection) return nodeRange(model, state, after);
  if (selection.empty) {
    const at = endOffset(model, state, selection.head, 0, after);
    return at === null ? null : { anchor: at, head: at };
  }
  const from = endOffset(model, state, selection.from, 1, after);
  const to = endOffset(model, state, selection.to, -1, after);
  if (from === null || to === null) return null;
  return selection.anchor <= selection.head ? { anchor: from, head: to } : { anchor: to, head: from };
}

function trimmedSelection(state: ModelState): ModelState {
  const { selection, doc } = state;
  if (selection.empty || !(selection instanceof TextSelection)) return state;
  const blankAt = (pos: number) => doc.resolve(pos).parent.inlineContent && BLANK.test(doc.textBetween(pos, pos + 1, "\n", "\n"));
  let { from, to } = selection;
  while (from < to && from < selection.$from.end() && blankAt(from)) from += 1;
  while (to > from && to > selection.$to.start() && blankAt(to - 1)) to -= 1;
  if (from === to || (from === selection.from && to === selection.to)) return state;
  const forward = selection.anchor <= selection.head;
  return state.apply(state.tr.setSelection(TextSelection.create(doc, forward ? from : to, forward ? to : from)));
}

const REVERT_LIMIT = 40;

interface Hunk {
  plainFrom: number;
  plainTo: number;
  visualFrom: number;
  visualTo: number;
}

function canonical(json: JSONContent): string {
  const content = [...(json.content ?? [])];
  while (content.length > 0 && content.at(-1)?.type === "paragraph" && !content.at(-1)?.content?.length) content.pop();
  return JSON.stringify(content);
}

function readsAs(model: Model, text: string): { key: string; text: string } {
  const doc = model.editor.schema.nodeFromJSON(parse(text).doc);
  return { key: canonical(doc.toJSON()), text: doc.textContent };
}

function hunksBetween(plain: string, visual: string): Hunk[] | null {
  const before = Array.from(plain);
  const after = Array.from(visual);
  const script = before.length + after.length <= SPLIT_DIFF_LIMIT ? myersEditScript(before, after) : null;
  if (!script) return null;
  const oldAt = [0];
  for (const char of before) oldAt.push((oldAt.at(-1) ?? 0) + char.length);
  const newAt = [0];
  for (const char of after) newAt.push((newAt.at(-1) ?? 0) + char.length);
  const hunks: Hunk[] = [];
  for (const edit of script) {
    if (edit.kind === "same") continue;
    const plainFrom = oldAt[edit.oldStart];
    const visualFrom = newAt[edit.newStart];
    const plainTo = edit.kind === "del" ? oldAt[edit.oldStart + edit.length] : plainFrom;
    const visualTo = edit.kind === "add" ? newAt[edit.newStart + edit.length] : visualFrom;
    const last = hunks.at(-1);
    if (last && last.plainTo === plainFrom && last.visualTo === visualFrom) {
      last.plainTo = plainTo;
      last.visualTo = visualTo;
    } else hunks.push({ plainFrom, plainTo, visualFrom, visualTo });
  }
  return hunks;
}

function built(plain: string, visual: string, hunks: readonly Hunk[], kept: readonly boolean[]): string {
  let out = "";
  let at = 0;
  hunks.forEach((hunk, index) => {
    out += plain.slice(at, hunk.plainFrom) + (kept[index] ? visual.slice(hunk.visualFrom, hunk.visualTo) : plain.slice(hunk.plainFrom, hunk.plainTo));
    at = hunk.plainTo;
  });
  return out + plain.slice(at);
}

function leastRewrite(model: Model, plain: string, visual: string, target: string, typedFrom: number, typedTo: number): { text: string; hunks: Hunk[]; kept: boolean[] } {
  const hunks = hunksBetween(plain, visual);
  if (!hunks) return { text: visual, hunks: [], kept: [] };
  const reads = (kept: readonly boolean[]) => readsAs(model, model.slice.head + built(plain, visual, hunks, kept)).key === target;
  const touching = hunks.map((hunk) => hunk.plainTo >= typedFrom - 2 && hunk.plainFrom <= typedTo + 2);
  if (reads(touching)) return { text: built(plain, visual, hunks, touching), hunks, kept: touching };
  const kept = hunks.map(() => true);
  const distance = (hunk: Hunk) => Math.max(0, hunk.plainFrom - typedTo, typedFrom - hunk.plainTo);
  const order = hunks.map((_, index) => index).sort((left, right) => distance(hunks[right]) - distance(hunks[left]));
  for (const index of order.slice(0, REVERT_LIMIT)) {
    kept[index] = false;
    if (!reads(kept)) kept[index] = true;
  }
  return { text: built(plain, visual, hunks, kept), hunks, kept };
}

function caretThrough(hunks: readonly Hunk[], kept: readonly boolean[], caret: number): number {
  let shift = 0;
  for (const [index, hunk] of hunks.entries()) {
    if (!kept[index]) continue;
    if (hunk.plainTo <= caret && hunk.plainFrom < caret) shift += hunk.visualTo - hunk.visualFrom - (hunk.plainTo - hunk.plainFrom);
    else if (hunk.plainFrom < caret && caret < hunk.plainTo) return Math.min(caret + shift, hunk.plainFrom + shift + (hunk.visualTo - hunk.visualFrom));
  }
  return caret + shift;
}

function typedEdit(model: Model, state: ModelState, from: number, body: string, range: { from: number; to: number }, inserted: string, prefix = ""): TransactionSpec | null {
  const { head } = model.slice;
  const at = range.from - from;
  const plain = body.slice(0, at) + inserted + body.slice(range.to - from);
  const typedEnd = at + inserted.length;
  const tr = state.tr;
  if (prefix + inserted) tr.insertText(prefix + inserted);
  else tr.deleteSelection();
  const next = state.apply(tr);
  const after = serializeMarkdownBody(next.doc.toJSON(), model.snapshot);
  const plainReads = readsAs(model, head + plain);
  const afterReads = after.startsWith(head) ? readsAs(model, after) : null;
  if (!afterReads || afterReads.text !== next.doc.textContent) {
    return plainReads.key === canonical(next.doc.toJSON()) ? null : carriedForward(model, state, from, plain, plainReads.key, at, prefix + inserted, inserted);
  }
  const target = afterReads.key;
  if (plainReads.key === target) return null;
  const visual = after.slice(head.length);
  const { text, hunks, kept } = leastRewrite(model, plain, visual, target, at, typedEnd);
  const caret = hunks.length > 0 ? caretThrough(hunks, kept, typedEnd) : text.length - (plain.length - typedEnd);
  return {
    changes: changesBetween(body, text).map((change) => ({ ...change, from: from + change.from, to: from + change.to })),
    selection: { anchor: from + caret },
    scrollIntoView: true,
  };
}

function carriedForward(model: Model, state: ModelState, from: number, plain: string, plainReads: string, at: number, modelText: string, inserted: string): TransactionSpec | null {
  if (!inserted || state.storedMarks === null || !state.selection.empty) return null;
  const position = state.selection.from;
  const tr = state.tr.insertText(modelText, position);
  tr.removeMark(position, position + modelText.length);
  for (const mark of state.selection.$from.marks()) tr.addMark(position, position + modelText.length, mark);
  const kept = state.apply(tr.setStoredMarks(state.storedMarks));
  if (canonical(kept.doc.toJSON()) !== plainReads) return null;
  const caret = from + at + inserted.length;
  return {
    changes: { from: from + at, to: from + at, insert: inserted },
    selection: { anchor: caret },
    effects: pendingTyping.of({ from: caret, to: caret, replace: (next) => guarded(() => typedEdit(model, kept, from, plain, { from: caret, to: caret }, next), null) }),
    scrollIntoView: true,
  };
}

function changesBetween(before: string, after: string): { from: number; to: number; insert: string }[] {
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

export function modelEdit(state: EditorState, act: (target: MarkdownTarget) => void): TransactionSpec | null {
  return guarded(() => editThroughModel(state, act), null);
}

function editThroughModel(state: EditorState, act: (target: MarkdownTarget) => void): TransactionSpec | null {
  const main = state.selection.main;
  const model = modelOf(state, main.from, main.to, 1);
  if (!model) return null;
  const anchor = placed(model, main.anchor);
  const head = main.empty ? anchor : placed(model, main.head);
  if (anchor === null || head === null) return null;
  select(model, anchor.position, head.position);
  loadedInput = null;
  act(visualTarget(model.editor));
  const after = serializeMarkdownBody(model.editor.getJSON(), model.snapshot);
  const { slice } = model;
  if (!after.startsWith(slice.head)) return null;
  const serialized = after.slice(slice.head.length);
  const lead = serialized ? slice.lead : "";
  const changes = state.changes(
    changesBetween(slice.text, lead + serialized).map((change) => ({ ...change, from: slice.from + change.from, to: slice.from + change.to })),
  );
  const start = slice.from + lead.length;
  const single = state.selection.ranges.length === 1;
  if (changes.empty) return single && main.empty ? bareCaret(model, state, start, serialized, anchor) : null;
  const typed = trimmedSelection(model.editor.state);
  const picked = sourceSelection(model, typed, after);
  const exact = picked !== null && Math.min(picked.anchor, picked.head) >= slice.head.length;
  const mainRange = exact
    ? EditorSelection.range(start + picked.anchor - slice.head.length, start + picked.head - slice.head.length)
    : fallbackRange(changes, main);
  const effects =
    exact && single
      ? pendingTyping.of({ from: mainRange.from, to: mainRange.to, replace: (inserted) => guarded(() => typedEdit(model, typed, start, serialized, mainRange, inserted), null) })
      : [];
  const ranges = state.selection.ranges.map((range, index) =>
    index === state.selection.mainIndex ? mainRange : EditorSelection.range(changes.mapPos(range.anchor, 1), changes.mapPos(range.head, 1)),
  );
  return {
    changes,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    effects,
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
    scrollIntoView: true,
  };
}

function fallbackRange(changes: ChangeSet, main: SelectionRange): SelectionRange {
  const range = EditorSelection.range(changes.mapPos(main.anchor, 1), changes.mapPos(main.head, 1));
  let covers = false;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (fromB < range.to && toB > range.from && (fromB > range.from || toB < range.to)) covers = true;
  });
  return covers ? EditorSelection.cursor(range.head) : range;
}

function bareCaret(model: Model, state: EditorState, start: number, body: string, at: { position: number; offset: number }): TransactionSpec | null {
  const caret = state.selection.main.head;
  const typed = model.editor.state;
  if (!typed.selection.empty || typed.selection.head !== at.position || at.offset > caret) return null;
  const prefix = state.doc.sliceString(at.offset, caret);
  if (prefix.trim() !== "") return null;
  return {
    effects: pendingTyping.of({
      from: caret,
      to: caret,
      replace: (inserted) => guarded(() => typedEdit(model, typed, start, body, { from: caret, to: caret }, inserted, prefix), null),
    }),
  };
}

function caretModel(state: EditorState): Model | null {
  const { head } = state.selection.main;
  const model = modelOf(state, head, head, 0);
  const position = model && modelPosition(model, head);
  if (!model || position === null) return null;
  select(model, position, position);
  return model;
}

function guarded<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    loadedInput = null;
    reportEditorError("markdown toolbar", error);
    return fallback;
  }
}

export function modelState(state: EditorState): MarkdownToolbarState {
  return guarded(() => {
    const model = caretModel(state);
    return (model && visualStateOf(model.editor)) ?? RESTING_STATE;
  }, RESTING_STATE);
}

export function modelLinkHref(state: EditorState): string {
  return guarded(() => {
    const model = caretModel(state);
    return model ? visualTarget(model.editor).linkHref() : "";
  }, "");
}

export function sourceTarget(viewOf: () => EditorView | null): MarkdownTarget {
  const run = (act: (target: MarkdownTarget) => void) => () => {
    const view = viewOf();
    if (!view || view.state.readOnly) return;
    const spec = modelEdit(view.state, act);
    if (spec) view.dispatch(spec);
    view.focus();
  };
  return {
    bold: run((target) => target.bold()),
    italic: run((target) => target.italic()),
    strike: run((target) => target.strike()),
    code: run((target) => target.code()),
    underline: run((target) => target.underline()),
    highlight: run((target) => target.highlight()),
    superscript: run((target) => target.superscript()),
    subscript: run((target) => target.subscript()),
    heading: (level) => run((target) => target.heading(level))(),
    paragraph: run((target) => target.paragraph()),
    codeBlock: run((target) => target.codeBlock()),
    bullet: run((target) => target.bullet()),
    ordered: run((target) => target.ordered()),
    quote: run((target) => target.quote()),
    align: (value) => run((target) => target.align(value))(),
    clear: run((target) => target.clear()),
    color: (spec) => run((target) => target.color(spec))(),
    emoji: (text) => run((target) => target.emoji(text))(),
    link: (typed) => run((target) => target.link(typed))(),
    unlink: run((target) => target.unlink()),
    linkHref: () => {
      const view = viewOf();
      return view ? modelLinkHref(view.state) : "";
    },
    image: (typed) => run((target) => target.image(typed))(),
    table: run((target) => target.table()),
  };
}
