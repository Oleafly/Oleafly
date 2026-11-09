import {
  markdownBlockKey,
  markdownPreservedRanges,
  serializeMarkdownDoc,
  splitMarkdownFrontMatter,
  type MarkdownSourceLayout,
  type MarkdownSourceSnapshot,
} from "@oleafly/wysiwyg";
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { diffNoteDocs, type NoteChangeDraft } from "./note-diff";
import { mergeSequences } from "./note-merge";
import { joinNoteSource, noteMarkdownExtensions, parseNoteMarkdown } from "./note-markdown";

export const NOTE_REMOTE = "noteRemote";

const LEAF = "\uFFFC";

export interface SharedNote {
  text: string;
  doc: ProseMirrorNode;
  frontmatter: string;
  layout: MarkdownSourceLayout | null;
  sources: string[];
  starts: number[];
}

export function isRemoteTransaction(transaction: Pick<Transaction, "getMeta">): boolean {
  return transaction.getMeta(NOTE_REMOTE) === true;
}

function children(node: ProseMirrorNode): ProseMirrorNode[] {
  const out: ProseMirrorNode[] = [];
  node.forEach((child) => {
    out.push(child);
  });
  return out;
}

function unitsOf(text: string, layout: MarkdownSourceLayout | null, count: number): { sources: string[]; starts: number[] } {
  const sources: string[] = [];
  const starts: number[] = [];
  if (layout) {
    const mapped =
      layout.units.reduce((sum, unit) => sum + unit.source.length, 0) +
      layout.separators.reduce((sum, separator) => sum + separator.length, 0) +
      layout.trailing.length;
    let start = Math.max(0, text.length - mapped);
    layout.units.forEach((unit, index) => {
      for (let node = 0; node < unit.nodes; node += 1) {
        sources.push(`${node}:${unit.source}`);
        starts.push(start);
      }
      start += unit.source.length + (layout.separators[index]?.length ?? 0);
    });
  }
  while (sources.length < count) {
    sources.push("");
    starts.push(layout ? text.length : 0);
  }
  return { sources: sources.slice(0, count), starts: starts.slice(0, count) };
}

const REFERENCE_DEFINITION = /^ {0,3}\[(?:[^\]\\\n]|\\.)+\]:/mu;
const BLANK_LINE = /\n[ \t]*\n/u;

function commonPrefix(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  return index;
}

function commonSuffix(left: string, right: string, limit: number): number {
  let index = 0;
  while (index < limit && left.charCodeAt(left.length - 1 - index) === right.charCodeAt(right.length - 1 - index)) index += 1;
  return index;
}

function unitStarts(text: string, layout: MarkdownSourceLayout): number[] | null {
  const mapped =
    layout.units.reduce((sum, unit) => sum + unit.source.length, 0) +
    layout.separators.reduce((sum, separator) => sum + separator.length, 0) +
    layout.trailing.length;
  let start = text.length - mapped;
  if (start < 0) return null;
  return layout.units.map((unit, index) => {
    const at = start;
    start += unit.source.length + (layout.separators[index]?.length ?? 0);
    return at;
  });
}

function nodesBefore(layout: MarkdownSourceLayout, index: number): number {
  let count = 0;
  for (let at = 0; at < index; at += 1) count += layout.units[at].nodes;
  return count;
}

function sameUnit(left: MarkdownSourceLayout["units"][number] | undefined, right: MarkdownSourceLayout["units"][number]): boolean {
  return left !== undefined && left.source === right.source && left.nodes === right.nodes;
}

interface TextRange {
  from: number;
  to: number;
}

function crosses(ranges: readonly TextRange[], at: number): boolean {
  return ranges.some((range) => range.from < at && at < range.to);
}

interface ProtectedRanges {
  math: readonly TextRange[];
  preserved: readonly TextRange[];
}

const protectedRanges = new WeakMap<SharedNote, ProtectedRanges>();

function scanRanges(text: string): ProtectedRanges {
  const bodyOffset = text.length - splitMarkdownFrontMatter(text).body.length;
  return { math: markdownMathRanges(text), preserved: markdownPreservedRanges(text, bodyOffset) };
}

function rangesOf(note: SharedNote): ProtectedRanges {
  let found = protectedRanges.get(note);
  if (!found) {
    found = scanRanges(note.text);
    protectedRanges.set(note, found);
  }
  return found;
}

function sameOutside(before: readonly TextRange[], after: readonly TextRange[], start: number, end: number, nextEnd: number): boolean {
  const delta = nextEnd - end;
  const kept = before.filter((range) => range.to <= start || range.from >= end);
  const now = after.filter((range) => range.to <= start || range.from >= nextEnd);
  return (
    kept.length === now.length &&
    kept.every((range, index) => {
      const shift = range.from >= end ? delta : 0;
      return range.from + shift === now[index].from && range.to + shift === now[index].to;
    })
  );
}

function sameRangesIn(whole: readonly TextRange[], from: number, to: number, local: readonly TextRange[]): boolean {
  if (crosses(whole, from) || crosses(whole, to)) return false;
  const inside = whole.filter((range) => range.from >= from && range.to <= to);
  return inside.length === local.length && inside.every((range, index) => range.from - from === local[index].from && range.to - from === local[index].to);
}

function leadWord(region: string): string {
  let word = "OLEAFLYXREGIONSTART";
  while (region.includes(word)) word += "X";
  return word;
}

function sameNodes(fresh: readonly ProseMirrorNode[], from: number, kept: readonly ProseMirrorNode[], start: number, count: number): boolean {
  for (let index = 0; index < count; index += 1) {
    const node = fresh[from + index];
    const other = kept[start + index];
    if (!node || !other || !node.eq(other)) return false;
  }
  return true;
}

function isEmptyParagraph(node: ProseMirrorNode | undefined): boolean {
  return node?.type.name === "paragraph" && node.content.size === 0;
}

function reparsedNote(schema: Schema, previous: SharedNote, text: string): SharedNote | null {
  const { layout } = previous;
  if (!layout || layout.units.length === 0) return null;
  if (previous.text.includes("<!--") || text.includes("<!--")) return null;
  if (REFERENCE_DEFINITION.test(previous.text) || REFERENCE_DEFINITION.test(text)) return null;
  const starts = unitStarts(previous.text, layout);
  if (!starts) return null;
  const count = layout.units.length;
  const prefix = commonPrefix(previous.text, text);
  const suffix = commonSuffix(previous.text, text, Math.min(previous.text.length, text.length) - prefix);
  if (prefix < starts[0]) return null;
  const changeEnd = previous.text.length - suffix;
  let first = Math.max(0, blockAtOffset(starts, prefix) - 1);
  let last = Math.min(count - 1, blockAtOffset(starts, changeEnd) + 1);
  while (first > 0 && !BLANK_LINE.test(layout.separators[first - 1])) first -= 1;
  while (last < count - 1 && !BLANK_LINE.test(layout.separators[last])) last += 1;
  const toEnd = last === count - 1;
  const regionStart = starts[first];
  const regionEnd = toEnd ? previous.text.length : starts[last] + layout.units[last].source.length;
  if (regionEnd < changeEnd) return null;
  const nextEnd = regionEnd + text.length - previous.text.length;
  if (nextEnd < regionStart) return null;
  const region = text.slice(regionStart, nextEnd);
  const was = rangesOf(previous);
  const now = scanRanges(text);
  if (!sameRangesIn(now.math, regionStart, nextEnd, markdownMathRanges(region))) return null;
  if (!sameRangesIn(now.preserved, regionStart, nextEnd, markdownPreservedRanges(region))) return null;
  if (!sameOutside(was.math, now.math, regionStart, regionEnd, nextEnd)) return null;
  if (!sameOutside(was.preserved, now.preserved, regionStart, regionEnd, nextEnd)) return null;
  const lead = first > 0 ? leadWord(region) : "";
  const sub = parseNoteMarkdown(lead ? `${lead}\n\n${region}` : region);
  if (!sub.layout || sub.frontmatter !== "") return null;
  let units = sub.layout.units;
  let separators = sub.layout.separators;
  let fresh = children(schema.nodeFromJSON(sub.doc));
  if (lead) {
    if (units[0]?.source !== lead || units[0].nodes !== 1) return null;
    units = units.slice(1);
    separators = separators.slice(1);
    fresh = fresh.slice(1);
  }
  if (units.length === 0) return null;
  const counted = units.reduce((sum, unit) => sum + unit.nodes, 0);
  if (!toEnd) {
    if (sub.layout.trailing !== "") return null;
    if (fresh.length === counted + 1 && isEmptyParagraph(fresh.at(-1))) fresh = fresh.slice(0, counted);
    if (fresh.length !== counted) return null;
  }
  const kept = children(previous.doc);
  const head = nodesBefore(layout, first);
  const before = starts[first] + layout.units[first].source.length <= prefix;
  if (before && !(sameUnit(units[0], layout.units[first]) && sameNodes(fresh, 0, kept, head, layout.units[first].nodes))) return null;
  const after = starts[last] >= changeEnd;
  const lastNodes = layout.units[last].nodes;
  if (
    after &&
    !(sameUnit(units.at(-1), layout.units[last]) && sameNodes(fresh, counted - lastNodes, kept, nodesBefore(layout, last), lastNodes))
  ) {
    return null;
  }
  const tail = toEnd ? [] : kept.slice(nodesBefore(layout, last + 1));
  let doc: ProseMirrorNode;
  try {
    doc = previous.doc.type.createChecked(previous.doc.attrs, [...kept.slice(0, head), ...fresh, ...tail]);
  } catch {
    return null;
  }
  const nextLayout: MarkdownSourceLayout = {
    units: [...layout.units.slice(0, first), ...units, ...layout.units.slice(last + 1)],
    separators: [...layout.separators.slice(0, first), ...separators, ...layout.separators.slice(last)],
    trailing: toEnd ? sub.layout.trailing : layout.trailing,
  };
  const note: SharedNote = { text, doc, frontmatter: previous.frontmatter, layout: nextLayout, ...unitsOf(text, nextLayout, doc.childCount) };
  protectedRanges.set(note, now);
  return note;
}

export function parseSharedNote(schema: Schema, text: string, previous: SharedNote | null = null): SharedNote {
  if (previous?.text === text) return previous;
  const reparsed = previous ? reparsedNote(schema, previous, text) : null;
  if (reparsed) return reparsed;
  const parsed = parseNoteMarkdown(text);
  const doc = schema.nodeFromJSON(parsed.doc);
  return { text, doc, frontmatter: parsed.frontmatter, layout: parsed.layout, ...unitsOf(text, parsed.layout, doc.childCount) };
}

interface KnownSource {
  frontMatter: string;
  separator: string;
  snapshot: MarkdownSourceSnapshot | null;
  text: string;
}

const knownSources = new WeakMap<ProseMirrorNode, KnownSource>();

export function noteSourceOf(
  doc: ProseMirrorNode,
  frontMatter: string,
  separator: string,
  snapshot: MarkdownSourceSnapshot | null,
): string {
  const known = knownSources.get(doc);
  if (known?.frontMatter === frontMatter && known.separator === separator && known.snapshot === snapshot) return known.text;
  const text = joinNoteSource(frontMatter, separator, serializeMarkdownDoc(doc, snapshot, noteMarkdownExtensions()));
  knownSources.set(doc, { frontMatter, separator, snapshot, text });
  return text;
}

export function blockKeysOf(doc: ProseMirrorNode): string[] {
  return children(doc).map(markdownBlockKey);
}

export function mergedDoc(base: SharedNote, current: ProseMirrorNode, next: SharedNote): ProseMirrorNode {
  const nodes = mergeSequences(children(base.doc), children(current), children(next.doc), markdownBlockKey, {
    base: base.sources,
    theirs: next.sources,
  });
  try {
    return current.type.createChecked(current.attrs, nodes);
  } catch {
    return next.doc;
  }
}

interface Place {
  index: number;
  start: number;
  end: number;
  textblock: number;
  offset: number;
}

interface Textblock {
  from: number;
  to: number;
}

function textblocksIn(doc: ProseMirrorNode, start: number): Textblock[] {
  const block = doc.nodeAt(start);
  if (!block) return [];
  if (block.isTextblock) return [{ from: start + 1, to: start + block.nodeSize - 1 }];
  const found: Textblock[] = [];
  block.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const from = start + 1 + pos + 1;
    found.push({ from, to: from + node.content.size });
    return false;
  });
  return found;
}

function placeOf(doc: ProseMirrorNode, pos: number): Place {
  let start = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    const end = start + doc.child(index).nodeSize;
    if (pos <= end || index === doc.childCount - 1) {
      const clamped = Math.min(Math.max(pos, start), end);
      const blocks = textblocksIn(doc, start);
      const textblock = blocks.findIndex((candidate) => candidate.from <= clamped && clamped <= candidate.to);
      const from = textblock >= 0 ? blocks[textblock].from : start;
      return { index, start, end, textblock, offset: doc.textBetween(from, clamped, "\n", LEAF).length };
    }
    start = end;
  }
  return { index: 0, start: 0, end: 0, textblock: -1, offset: 0 };
}

function offsetIn(doc: ProseMirrorNode, from: number, to: number, offset: number): number {
  let low = from;
  let high = to;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (doc.textBetween(from, middle, "\n", LEAF).length < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function positionInBlock(doc: ProseMirrorNode, start: number, place: Pick<Place, "textblock" | "offset">): number {
  const block = doc.nodeAt(start);
  if (!block) return Math.min(start, doc.content.size);
  const blocks = textblocksIn(doc, start);
  if (place.textblock >= 0 && blocks.length > 0) {
    const target = blocks[Math.min(place.textblock, blocks.length - 1)];
    return offsetIn(doc, target.from, target.to, place.offset);
  }
  const end = start + block.nodeSize;
  return Math.min(Math.max(offsetIn(doc, start, end, place.offset), start + 1), end - 1);
}

function blockStart(doc: ProseMirrorNode, index: number): number {
  let start = 0;
  for (let at = 0; at < Math.min(index, doc.childCount); at += 1) start += doc.child(at).nodeSize;
  return start;
}

function restoredPosition(
  tr: Transaction,
  before: ProseMirrorNode,
  drafts: readonly NoteChangeDraft[] | null,
  pos: number,
): number {
  const place = placeOf(before, pos);
  if (drafts === null) {
    const index = Math.min(place.index, tr.doc.childCount - 1);
    return positionInBlock(tr.doc, blockStart(tr.doc, index), place);
  }
  const draft = drafts.find((change) => change.kind === "blocks" && change.from <= place.start && place.end <= change.to);
  if (draft?.kind !== "blocks" || draft.nodes.length === 0) return tr.mapping.map(pos);
  let skipped = 0;
  let at = draft.from;
  while (at < place.start) {
    const node = before.nodeAt(at);
    if (!node) break;
    at += node.nodeSize;
    skipped += 1;
  }
  const pick = Math.min(skipped, draft.nodes.length - 1);
  let start = tr.mapping.map(draft.from, -1);
  for (let index = 0; index < pick; index += 1) start += draft.nodes[index].nodeSize;
  return positionInBlock(tr.doc, start, place);
}

function keepSelection(
  tr: Transaction,
  selection: Selection,
  before: ProseMirrorNode,
  drafts: readonly NoteChangeDraft[] | null,
): void {
  if (!(selection instanceof TextSelection)) return;
  const anchor = restoredPosition(tr, before, drafts, selection.anchor);
  const head = restoredPosition(tr, before, drafts, selection.head);
  tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(head)));
}

function applyDrafts(tr: Transaction, drafts: readonly NoteChangeDraft[]): void {
  const { schema } = tr.doc.type;
  for (const draft of [...drafts].reverse()) {
    if (draft.kind === "blocks") {
      tr.replaceWith(draft.from, draft.to, Fragment.from(draft.nodes));
    } else if (draft.text) {
      tr.replaceWith(draft.from, draft.to, schema.text(draft.text, tr.doc.resolve(draft.from).marks()));
    } else {
      tr.delete(draft.from, draft.to);
    }
  }
}

export function showSharedNote(editor: Editor, base: SharedNote | null, next: SharedNote): void {
  showNoteDoc(editor, base ? mergedDoc(base, editor.state.doc, next) : next.doc);
}

export function showNoteDoc(editor: Editor, target: ProseMirrorNode): void {
  const { state } = editor;
  const current = state.doc;
  if (target.eq(current)) return;
  const drafts = diffNoteDocs(current, target);
  let tr = state.tr;
  applyDrafts(tr, drafts);
  let placed: readonly NoteChangeDraft[] | null = drafts;
  if (!tr.doc.eq(target)) {
    tr = state.tr.replaceWith(0, current.content.size, target.content);
    placed = null;
  }
  keepSelection(tr, state.selection, current, placed);
  tr.setMeta(NOTE_REMOTE, true).setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

export function blockIndexAt(doc: ProseMirrorNode, pos: number): number {
  return placeOf(doc, pos).index;
}

export function blockAtOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  if (high < 0) return 0;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function blockPosition(doc: ProseMirrorNode, index: number): number {
  return blockStart(doc, Math.max(0, Math.min(index, doc.childCount - 1)));
}
