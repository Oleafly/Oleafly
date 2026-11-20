import { isolateHistory } from "@codemirror/commands";
import { type ChangeSet, EditorSelection, type EditorState, type SelectionRange, type Text, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Editor } from "@tiptap/core";
import { Mark, type Node as ModelNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import {
  WYSIWYG_EXTENSIONS,
  createMarkdownSourceSnapshot,
  type MarkdownSourceSnapshot,
  type MarkdownUnits,
  markdownUnits,
  serializeMarkdownBody,
} from "@oleafly/wysiwyg";
import { readableLinkHref } from "@oleafly/wysiwyg/link-destination";
import type { TextAlign } from "@oleafly/wysiwyg/text-align-values";
import { minimalReplacement } from "@oleafly/editor/CodeMirrorEditor";
import { visualLinkHref } from "@/components/editor/markdown-commands";
import { bareCaret, changesBetween, endOffset, parse, pendingMarks, reported, settledEnds, typingAfter } from "@/components/editor/markdown-typing";
import {
  alignable,
  alignmentOf,
  alignText,
  applyLink,
  applyTextColor,
  clearFormatting,
  currentLinkHref,
  quotable,
  TASK_MARKER,
  textColorOf,
  toggleQuote,
} from "@/components/editor/rich-text-controls";
import { ALIGN_FENCE_OPEN } from "@/components/editor/markdown-preview-markup";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import type { MarkdownIt, MdToken } from "@/components/notes/note-markdown-it";

export interface MarkdownToolbarState {
  align: TextAlign;
  textColor: string | null;
  link: boolean;
  aligns: boolean;
  quotes: boolean;
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
  link(typed: string): boolean;
  unlink(): void;
  linkHref(): string;
  image(typed: string): boolean;
  table(): void;
}

export const RESTING_STATE: MarkdownToolbarState = { align: "left", textColor: null, link: false, aligns: true, quotes: true, heading: null };

export const IDLE_TARGET = new Proxy({}, { get: () => () => "" }) as MarkdownTarget;

export function visualStateOf(editor: Editor | null): MarkdownToolbarState | null {
  if (!editor || editor.isDestroyed) return null;
  return {
    align: alignmentOf(editor),
    textColor: textColorOf(editor),
    link: editor.isActive("link"),
    aligns: alignable(editor),
    quotes: quotable(editor),
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
    left.quotes === right.quotes &&
    left.heading === right.heading
  );
}

function atomsAsSource(tr: Transaction): boolean {
  const atoms: { at: number; node: ModelNode }[] = [];
  tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (!node.type.spec.code) {
      node.forEach((child, offset) => {
        if (child.isInline && child.isAtom && typeof child.attrs.source === "string") atoms.push({ at: pos + 1 + offset, node: child });
      });
    }
    return false;
  });
  for (const { at, node } of atoms.reverse()) {
    const source = serializeMarkdownBody({ type: "doc", content: [{ type: "paragraph", content: [node.toJSON()] }] }).replace(/\n+$/u, "");
    if (source) tr.replaceWith(at, at + node.nodeSize, tr.doc.type.schema.text(source));
  }
  return atoms.length > 0;
}

export function visualTarget(editor: Editor): MarkdownTarget {
  const chain = () => editor.chain().focus();
  const listOutsideTables = (toggle: () => boolean) => () => !editor.isActive("table") && toggle();
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
    codeBlock: () => {
      if (!editor.isActive("codeBlock")) chain().command(({ tr }) => atomsAsSource(tr)).run();
      chain().toggleCodeBlock().run();
    },
    bullet: listOutsideTables(() => chain().toggleBulletList().run()),
    ordered: listOutsideTables(() => chain().toggleOrderedList().run()),
    quote: () => toggleQuote(editor),
    align: (value) => alignText(editor, value),
    clear: () => clearFormatting(editor),
    color: (spec) => applyTextColor(editor, spec),
    emoji: (text) => chain().insertContent(text).run(),
    link: (typed) => {
      const text = typed.trim();
      return applyLink(editor, text && visualLinkHref(text), text);
    },
    unlink: () => chain().extendMarkRange("link").unsetLink().run(),
    linkHref: () => readableLinkHref(currentLinkHref(editor)),
    image: (typed) => {
      const path = typed.trim();
      return path !== "" && chain().setImage({ src: visualLinkHref(path), alt: "" }).run();
    },
    table: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  };
}

export const MODEL_DOC_LIMIT = 500_000;
export const MODEL_SLICE_LIMIT = 10_000;
const OWN_LINE_STEPS = 32;
const SPAN_CANDIDATES = 32;
const LEADING_RULE = /^ {0,3}---[ \t]*(?:\r?\n|$)/u;
const LEAF_TOKENS = new Set(["paragraph_open", "heading_open", "fence", "code_block", "hr", "html_block", "table_open"]);
const BLANKISH = /^[\s>]*$/u;
const EMPTY_CONTAINER = /^[\s>]*(?:(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?)?[ \t]*$/u;

type Span = { from: number; to: number };
type Spot = { position: number; offset: number };
type Act = (target: MarkdownTarget) => void;

interface Slice {
  from: number;
  to: number;
  text: string;
  head: string;
  lead: string;
  units: readonly Span[];
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
  attributed: Set<number>;
  slice: Slice;
  nodes: readonly ([number, number] | null)[];
}

interface Leaf {
  first: number;
  last: number;
  textFirst: number;
  textLast: number;
  text: boolean;
  rule?: number;
}

interface Structure {
  starts: number[];
  lines: string[];
  leaves: Leaf[];
  divs: { open: number; close: number; leaves: Leaf[] }[];
}

interface Analysis {
  source: string;
  units: MarkdownUnits;
  math: Span[];
}

const analysed = new WeakMap<Text, Analysis>();
const structures = new Map<string, Structure>();
let scratchEditor: Editor | null = null;
let primed = false;
let loaded: Omit<Model, "doc" | "slice"> | null = null;
let loadedInput: string | null = null;

function analysisOf(doc: Text): Analysis {
  let analysis = analysed.get(doc);
  if (!analysis) {
    const source = doc.toString();
    const math = markdownMathRanges(source);
    analysis = { source, units: markdownUnits(source, { preservedInlineRanges: math }), math };
    analysed.set(doc, analysis);
  }
  return analysis;
}

function headOf(references: MarkdownUnits["references"], text: string): string {
  if (references.size === 0) return "";
  const folded = text.replace(/\s+/gu, " ").toLowerCase().toUpperCase();
  const lines: string[] = [];
  for (const [label, { href, title }] of references) {
    if (folded.includes(label.replace(/\s+/gu, " ").toLowerCase().toUpperCase())) lines.push(`[${label}]: <${href}>${title ? ` "${title.replace(/["\\]/gu, "\\$&")}"` : ""}`);
  }
  return lines.length > 0 ? `${lines.join("\n")}\n\n` : "";
}

const DIV_OPEN = /^ {0,3}:{3,}[ \t]*(?:\{[^{}\n]*\}|[^\s{}:]+)[ \t]*:*[ \t]*\r?\n/u;
const DIV_CLOSE = /\r?\n {0,3}:{3,}[ \t]*(?:\r?\n)?$/u;

function divBody(source: string, span: Span): Span | null {
  const text = source.slice(span.from, span.to);
  const open = DIV_OPEN.exec(text);
  if (!open || ALIGN_FENCE_OPEN.test(text)) return null;
  const close = DIV_CLOSE.exec(text);
  if (!close || close.index <= open[0].length) return null;
  return { from: span.from + open[0].length, to: span.from + close.index };
}

function innerSpans(source: string, body: Span): Span[] {
  const text = source.slice(body.from, body.to);
  return markdownUnits(text, { preservedInlineRanges: markdownMathRanges(text) }).spans.map((span) => ({ from: body.from + span.from, to: body.from + span.to }));
}

function spanIndex(spans: readonly Span[], offset: number, before: boolean): number {
  let index = 0;
  for (const [at, span] of spans.entries()) if (before ? span.from < offset : span.from <= offset) index = at;
  return index;
}

function sliceOf(doc: Text, from: number, to: number, margin: number): Slice {
  const { source, units } = analysisOf(doc);
  const { bodyFrom, spans: top, references } = units;
  if (top.length === 0) {
    const body = source.slice(bodyFrom);
    if (body.trim() !== "") return { from: bodyFrom, to: source.length, text: body, head: headOf(references, body), lead: "", units: [{ from: bodyFrom, to: source.length }] };
    const gap = Math.min(2, (/\n*$/u.exec(source.slice(0, bodyFrom))?.[0] ?? "").length);
    return { from: source.length, to: source.length, text: "", head: "", lead: bodyFrom > 0 ? "\n\n".slice(gap) : "", units: [{ from: source.length, to: source.length }] };
  }
  let spans: readonly Span[] = top;
  for (;;) {
    const at = spanIndex(spans, from, false);
    if (at !== spanIndex(spans, to, to > from)) break;
    const body = divBody(source, spans[at]);
    if (!body || from < body.from || to > body.to) break;
    const inner = innerSpans(source, body);
    if (inner.length === 0) break;
    spans = inner;
  }
  const unitOf = (offset: number, before: boolean) => spanIndex(spans, offset, before);
  const picked = unitOf(from, false);
  let first = Math.max(0, picked - margin);
  while (first < picked && LEADING_RULE.test(source.slice(spans[first].from, spans[first].to))) first += 1;
  const last = Math.min(spans.length - 1, unitOf(to, to > from) + margin);
  const text = source.slice(spans[first].from, spans[last].to);
  return { from: spans[first].from, to: spans[last].to, text, head: headOf(references, text), lead: "", units: spans.slice(first, last + 1) };
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

function loadModel(input: string): Omit<Model, "doc" | "slice" | "nodes"> | null {
  const parsed = parse(input);
  if (parsed.frontmatter) return null;
  // Nothing listens for the "delete" event here, and TipTap's core Delete extension queues a timer after every
  // update: one per toolbar action, which piled up to thousands in the corpus sweep.
  scratchEditor ??= new Editor({ element: document.createElement("div"), extensions: WYSIWYG_EXTENSIONS, enableCoreExtensions: { delete: false } });
  const editor = scratchEditor;
  editor.chain().setMeta("addToHistory", false).setContent(parsed.doc, { emitUpdate: false }).run();
  const json = editor.getJSON();
  const snapshot = createMarkdownSourceSnapshot(parsed.layout, json);
  if (serializeMarkdownBody(json, snapshot) !== input) return null;
  const clean = editor.schema.nodeFromJSON(parsed.doc);
  const { doc } = editor.state;
  if (clean.childCount > doc.childCount || clean.content.content.some((node, index) => !node.eq(doc.child(index)))) return null;
  return { editor, mark: sentinelFor(input), clean, cleanJson: JSON.stringify(clean.toJSON()), snapshot, input, positions: new Map(), attributed: new Set() };
}

function unitNodes(snapshot: MarkdownSourceSnapshot | null, units: readonly Span[], doc: Text): ([number, number] | null)[] {
  const layout = snapshot?.layout.units ?? [];
  const ranges: [number, number][] = [];
  let index = 0;
  let node = 0;
  for (const unit of units) {
    const source = doc.sliceString(unit.from, unit.to);
    while (index < layout.length && layout[index].source !== source) node += layout[index++].nodes;
    if (index >= layout.length) return units.map(() => null);
    ranges.push([node, node + layout[index].nodes]);
    node += layout[index++].nodes;
  }
  return ranges;
}

function modelOf(state: EditorState, from: number, to: number, margin: number): Model | null {
  if (state.doc.length > MODEL_DOC_LIMIT) return null;
  const slice = sliceOf(state.doc, from, to, margin);
  const input = slice.head + slice.text;
  if (input.length > MODEL_SLICE_LIMIT) return null;
  if (loadedInput !== input) {
    const model = loadModel(input);
    loaded = model && { ...model, nodes: unitNodes(model.snapshot, slice.units, state.doc) };
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
  if (!model.positions.has(offset)) {
    const found = positionAt(model, offset);
    model.positions.set(offset, found?.position ?? null);
    if (found?.attribute) model.attributed.add(offset);
  }
  return model.positions.get(offset) ?? null;
}

const PUNCTUATION_MARKS = ["\u2E3A", "\u2E3B", "\u2E50", "\u2E51"];

function positionAt(model: Model, offset: number): { position: number; attribute: boolean } | null {
  const punctuation = PUNCTUATION_MARKS.find((mark) => !model.input.includes(mark));
  return positionWith(model, offset, model.mark) ?? (punctuation ? positionWith(model, offset, punctuation) : null);
}

function positionWith(model: Model, offset: number, mark: string): { position: number; attribute: boolean } | null {
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
  const relaxed = () => {
    const doc = withCleanMarks(back, model.clean, position);
    return doc !== null && matches(doc, model, mark);
  };
  return matches(back, model, mark) || relaxed() ? { position, attribute: found.length === 0 } : null;
}

function holdsText(doc: ModelNode, [from, to]: readonly [number, number]): boolean {
  let found = false;
  for (let index = from; index < Math.min(to, doc.childCount) && !found; index += 1) {
    const node = doc.child(index);
    found = node.isTextblock;
    node.descendants((child) => {
      if (child.isTextblock) found = true;
      return !found;
    });
  }
  return found;
}

function blockParser(editor: Editor): MarkdownIt {
  const { parser } = (editor.storage as unknown as { markdown: { parser: { md: MarkdownIt; parse(content: string): string } } }).markdown;
  if (!primed) {
    parser.parse("");
    primed = true;
  }
  return parser.md;
}

function maskedMath(text: string, math: readonly Span[], offset: number): string {
  let out = "";
  let at = 0;
  for (const range of math) {
    const from = Math.max(range.from - offset, at);
    const to = Math.min(range.to - offset, text.length);
    if (to <= from) continue;
    out += text.slice(at, from) + text.slice(from, to).replace(/[^\n]/gu, "x").replace(/^$/gmu, "x");
    at = to;
  }
  return out + text.slice(at);
}

function onlyTaskMarker(text: string): boolean {
  const marker = text.trim();
  return marker.length === 3 && TASK_MARKER.test(marker);
}

function imageOnly(group: readonly MdToken[], first: boolean): boolean {
  return (
    group.some((child) => child.type === "image") &&
    group.every((child) => child.type === "image" || (child.type === "text" && (child.content.trim() === "" || (first && onlyTaskMarker(child.content)))))
  );
}

function leaf(first: number, last: number, text = true): Leaf {
  return { first, last, textFirst: first, textLast: last, text };
}

function paragraphLeaves(first: number, last: number, inline: MdToken | undefined): Leaf[] {
  const groups: MdToken[][] = [[]];
  for (const child of inline?.children ?? []) {
    if (child.type === "softbreak" || child.type === "hardbreak") groups.push([]);
    else groups[groups.length - 1].push(child);
  }
  if (groups.length !== last - first + 1) return [leaf(first, last)];
  const leaves: Leaf[] = [];
  let start = first;
  groups.forEach((group, index) => {
    if (!imageOnly(group, index === 0)) return;
    if (start < first + index) leaves.push(leaf(start, first + index - 1));
    leaves.push(leaf(first + index, first + index));
    start = first + index + 1;
  });
  if (start <= last) leaves.push(leaf(start, last));
  return leaves;
}

function leavesOf(token: MdToken, inline: MdToken | undefined, lines: readonly string[]): Leaf[] {
  const [first, end] = token.map ?? [0, 0];
  let last = Math.min(end, lines.length) - 1;
  while (last > first && BLANKISH.test(lines[last])) last -= 1;
  if (token.type === "hr") return [leaf(first, last, false)];
  if (token.type === "paragraph_open") return paragraphLeaves(first, last, inline);
  if (token.type === "heading_open") return [{ ...leaf(first, last), textLast: (token.markup === "=" || token.markup === "-") && last > first ? last - 1 : last }];
  if (token.type === "table_open") return [{ ...leaf(first, last), rule: first + 1 }];
  if (token.type !== "fence") return [leaf(first, last)];
  const closing = lines[last].replace(/^[\s>]*/u, "");
  const textLast = last > first && closing.startsWith(token.markup) && /^(?:`+|~+)[ \t]*$/u.test(closing) ? last - 1 : last;
  return [{ first, last, textFirst: first + 1, textLast, text: first + 1 <= textLast }];
}

function structureOf(model: Model, unit: Span): Structure {
  const text = model.doc.sliceString(unit.from, unit.to);
  const known = structures.get(text);
  if (known) return known;
  const lines = text.split("\n");
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  const leaves: Leaf[] = [];
  const divs: Structure["divs"] = [];
  const open: { line: number; close: number; from: number }[] = [];
  const tokens = blockParser(model.editor).parse(maskedMath(text, analysed.get(model.doc)?.math ?? [], unit.from), {});
  tokens.forEach((token, index) => {
    if (token.type === "align_div_open" && token.map) open.push({ line: token.map[0], close: token.map[1] - 1, from: leaves.length });
    else if (token.type === "align_div_close") {
      const div = open.pop();
      if (div) divs.push({ open: div.line, close: div.close, leaves: leaves.slice(div.from) });
    } else if (LEAF_TOKENS.has(token.type) && token.map) leaves.push(...leavesOf(token, tokens[index + 1], lines));
  });
  const structure = { starts, lines, leaves, divs };
  if (structures.size > 64) structures.clear();
  structures.set(text, structure);
  return structure;
}

function spread(range: Span, origin: number, limit: number, skip?: Span): number[] {
  const out: number[] = [];
  const keep = (at: number) => at >= range.from && at <= range.to && !(skip && at >= skip.from && at <= skip.to);
  for (let step = 0; out.length < limit && (origin - step >= range.from || origin + step <= range.to); step += 1) {
    if (keep(origin - step)) out.push(origin - step);
    if (step > 0 && out.length < limit && keep(origin + step)) out.push(origin + step);
  }
  return out;
}

interface Around {
  index: number;
  inside: boolean;
  end: boolean;
}

function unitAround(model: Model, offset: number): Around | null {
  const { slice, doc } = model;
  let before = -1;
  for (const [index, unit] of slice.units.entries()) {
    if (unit.from <= offset && offset <= unit.to) return { index, inside: true, end: false };
    if (unit.to <= offset) before = index;
  }
  if (doc.lineAt(Math.max(0, Math.min(doc.length, offset))).text.trim() !== "") return null;
  if (before >= 0) return { index: before, inside: false, end: true };
  const after = slice.units.findIndex((unit) => unit.from >= offset);
  return after >= 0 ? { index: after, inside: false, end: false } : null;
}

function lineAt(starts: readonly number[], offset: number): number {
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
  return line;
}

function candidatesFor(model: Model, offset: number, around: Around): number[] {
  const unit = model.slice.units[around.index];
  const { starts, lines, leaves, divs } = structureOf(model, unit);
  const span = (first: number, last: number): Span => ({ from: unit.from + starts[first], to: unit.from + starts[last] + lines[last].length });
  const toward = (target: Leaf | undefined, atEnd: boolean) => {
    if (!target?.text) return [];
    const range = span(target.textFirst, target.textLast);
    return spread(range, atEnd ? range.to : range.from, SPAN_CANDIDATES);
  };
  if (!around.inside) return toward(around.end ? leaves.at(-1) : leaves[0], around.end);
  const line = lineAt(starts, offset - unit.from);
  const own = span(line, line);
  const holder = leaves.find((each) => each.first <= line && line <= each.last);
  if (holder) {
    if (!holder.text) return [];
    if (line < holder.textFirst || line > holder.textLast) return toward(holder, line > holder.textLast);
    const rest = spread(span(holder.textFirst, holder.textLast), offset, SPAN_CANDIDATES, own);
    return line === holder.rule ? rest : [...spread(own, offset, OWN_LINE_STEPS * 2 + 1), ...rest];
  }
  const div = divs.find((each) => each.open === line || each.close === line);
  if (div) return toward(line === div.open ? div.leaves[0] : div.leaves.at(-1), line !== div.open);
  if (BLANKISH.test(lines[line])) {
    const above = leaves.filter((each) => each.last < line).at(-1);
    if (above) return toward(above, true);
    const below = leaves.find((each) => each.first > line);
    if (below) return toward(below, false);
  }
  return EMPTY_CONTAINER.test(lines[line]) ? spread(own, offset, OWN_LINE_STEPS * 2 + 1) : [];
}

function onTextLine(model: Model, offset: number, around: Around): boolean {
  const unit = model.slice.units[around.index];
  const { starts, leaves } = structureOf(model, unit);
  const line = lineAt(starts, offset - unit.from);
  return leaves.some((each) => each.text && each.textFirst <= line && line <= each.textLast);
}

function placed(model: Model, sourceOffset: number): Spot | null {
  const around = unitAround(model, sourceOffset);
  if (!around) return null;
  const nodes = model.nodes[around.index] ?? null;
  if (nodes && !holdsText(model.clean, nodes)) return null;
  const spot = (offset: number): Spot | null => {
    const position = exactPosition(model, offset - model.slice.from);
    if (position === null) return null;
    const top = model.clean.resolve(position).index(0);
    return nodes && (top < nodes[0] || top >= nodes[1]) ? null : { position, offset };
  };
  const own = around.inside ? spot(sourceOffset) : null;
  if (own && (!model.attributed.has(sourceOffset - model.slice.from) || onTextLine(model, sourceOffset, around))) return own;
  for (const candidate of candidatesFor(model, sourceOffset, around)) {
    const found = spot(candidate);
    if (found) return found;
  }
  return null;
}

type ModelState = Editor["state"];

const BLANK = /[ \t\u00a0]/u;

function select(model: Model, anchor: number, head: number) {
  const { editor } = model;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, anchor, head)));
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

function rangeEnd(model: Model, state: ModelState, after: string): number | null {
  const { $from, $to, to } = state.selection;
  return endOffset(model, state, to, -1, after, false, $from.marksAcross($to) ?? []);
}

function sourceSelection(model: Model, state: ModelState, after: string): { anchor: number | null; head: number | null } {
  const { selection } = state;
  if (selection instanceof NodeSelection) return nodeRange(model, state, after) ?? { anchor: null, head: null };
  if (selection.empty) {
    const at = endOffset(model, state, selection.head, 0, after);
    return { anchor: at, head: at };
  }
  const from = endOffset(model, state, selection.from, 1, after);
  const to = rangeEnd(model, state, after);
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

function idle(before: ModelState, after: ModelState): boolean {
  const [stored, now] = [before.storedMarks, after.storedMarks];
  return before.doc.eq(after.doc) && before.selection.eq(after.selection) && (stored === now || (stored !== null && now !== null && Mark.sameSet(stored, now)));
}

function settled(model: Model, state: EditorState, offset: number, at: Spot): number {
  if (at.offset >= offset) return at.offset;
  const skipped = state.doc.sliceString(at.offset, offset);
  const breaks = model.clean.resolve(Math.min(at.position, model.clean.content.size)).nodeAfter?.type.name === "hardBreak";
  return skipped.trim() !== "" || (skipped.includes("\n") && !/\n[ \t]*\n/u.test(skipped)) || breaks ? at.offset : offset;
}

function unchanged(model: Model, state: EditorState, start: number, body: string, ends: [Spot, Spot], quiet: boolean): TransactionSpec | null {
  const main = state.selection.main;
  const anchor = settled(model, state, main.anchor, ends[0]);
  const head = main.empty ? anchor : settled(model, state, main.head, ends[1]);
  const moved = anchor !== main.anchor || head !== main.head;
  if (main.empty) {
    const handed = bareCaret(model, moved && !quiet ? state.update({ selection: { anchor } }).state : state, start, body, ends[0]);
    return moved && !quiet ? { ...handed, selection: { anchor }, scrollIntoView: true } : handed;
  }
  if (quiet) return { effects: typingAfter(model, model.editor.state, start, body, { from: main.from, to: main.to }, true) };
  return { selection: { anchor, head }, effects: typingAfter(model, model.editor.state, start, body, { from: Math.min(anchor, head), to: Math.max(anchor, head) }), scrollIntoView: moved };
}

export function modelEdit(state: EditorState, act: Act): TransactionSpec | null {
  return guarded(() => editThroughModel(state, act, true), null);
}

function editThroughModel(state: EditorState, act: Act, quiet: boolean): TransactionSpec | null {
  const main = state.selection.main;
  const model = modelOf(state, main.from, main.to, 1);
  if (!model) return null;
  const anchor = placed(model, main.anchor);
  const head = main.empty ? anchor : placed(model, main.head);
  if (anchor === null || head === null) return null;
  select(model, anchor.position, head.position);
  const stored = main.empty ? pendingMarks(state) : null;
  if (stored) model.editor.view.dispatch(model.editor.state.tr.setStoredMarks([...stored]));
  loadedInput = null;
  const before = model.editor.state;
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
  if (changes.empty) return single ? unchanged(model, state, start, serialized, [anchor, head], quiet && idle(before, model.editor.state)) : null;
  const typed = trimmedSelection(model.editor.state);
  const picked = sourceSelection(model, typed, after);
  const toSource = (at: number | null) => (at !== null && at >= slice.head.length ? start + at - slice.head.length : null);
  const [anchorAt, headAt] = [toSource(picked.anchor), toSource(picked.head)];
  const exact = anchorAt !== null || headAt !== null;
  const mainRange = exact
    ? settledRange(changes.apply(state.doc).toString(), EditorSelection.range(anchorAt ?? changes.mapPos(main.anchor, 1), headAt ?? changes.mapPos(main.head, 1)))
    : fallbackRange(changes, main);
  const effects = exact && single ? typingAfter(model, typed, start, serialized, mainRange) : [];
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

function settledRange(text: string, range: SelectionRange): SelectionRange {
  if (range.empty) return range;
  const [from, to] = settledEnds(text, range.from, range.to);
  return range.anchor <= range.head ? EditorSelection.range(from, to) : EditorSelection.range(to, from);
}

function fallbackRange(changes: ChangeSet, main: SelectionRange): SelectionRange {
  const range = EditorSelection.range(changes.mapPos(main.anchor, 1), changes.mapPos(main.head, 1));
  let covers = false;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (fromB < range.to && toB > range.from && (fromB > range.from || toB < range.to)) covers = true;
  });
  return covers ? EditorSelection.cursor(range.head) : range;
}

function caretModel(state: EditorState): Model | null {
  const { head } = state.selection.main;
  const model = modelOf(state, head, head, 0);
  const position = model && placed(model, head)?.position;
  if (!model || position === null || position === undefined) return null;
  select(model, position, position);
  return model;
}

function guarded<T>(run: () => T, fallback: T): T {
  return reported(run, fallback, () => {
    loadedInput = null;
  });
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
  const run = (act: Act) => () => {
    const view = viewOf();
    if (!view || view.state.readOnly) return;
    const spec = guarded(() => editThroughModel(view.state, act, false), null);
    if (spec) view.dispatch(spec);
    view.focus();
  };
  const accepted = (act: (target: MarkdownTarget) => boolean) => {
    let valid = true;
    run((target) => {
      valid = act(target);
    })();
    return valid;
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
    link: (typed) => accepted((target) => target.link(typed)),
    unlink: run((target) => target.unlink()),
    linkHref: () => {
      const view = viewOf();
      return view ? modelLinkHref(view.state) : "";
    },
    image: (typed) => accepted((target) => target.image(typed)),
    table: run((target) => target.table()),
  };
}
