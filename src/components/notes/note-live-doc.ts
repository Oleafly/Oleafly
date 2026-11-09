import {
  createMarkdownSourceSnapshot,
  markdownBlockKey,
  markdownPreservedRanges,
  serializeMarkdownDoc,
  splitMarkdownFrontMatter,
  type MarkdownSourceLayout,
  type MarkdownSourceSnapshot,
} from "@oleafly/wysiwyg";
import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { type EditorState, TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { myersEditScript } from "@/lib/myers-diff";
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
  readonly sources: readonly string[];
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

interface UnitIndex {
  layout: MarkdownSourceLayout;
  unit: readonly number[];
  node: readonly number[];
}

const unitIndexes = new WeakMap<SharedNote, UnitIndex>();

function noteWith(fields: Omit<SharedNote, "sources">, index: UnitIndex | null, given?: readonly string[]): SharedNote {
  let sources: readonly string[] | null = given ?? null;
  const note: SharedNote = {
    ...fields,
    get sources() {
      sources ??= index
        ? index.unit.map((unit, at) => (unit < 0 ? "" : `${index.node[at]}:${index.layout.units[unit].source}`))
        : fields.starts.map(() => "");
      return sources;
    },
  };
  if (index) unitIndexes.set(note, index);
  return note;
}

function mappedLength(layout: MarkdownSourceLayout): number {
  return (
    layout.units.reduce((sum, unit) => sum + unit.source.length, 0) +
    layout.separators.reduce((sum, separator) => sum + separator.length, 0) +
    layout.trailing.length
  );
}

function sharedNoteOf(text: string, doc: ProseMirrorNode, frontmatter: string, layout: MarkdownSourceLayout | null): SharedNote {
  const count = doc.childCount;
  const unit: number[] = [];
  const node: number[] = [];
  const starts: number[] = [];
  if (layout) {
    let start = Math.max(0, text.length - mappedLength(layout));
    layout.units.forEach((entry, index) => {
      for (let at = 0; at < entry.nodes && starts.length < count; at += 1) {
        unit.push(index);
        node.push(at);
        starts.push(start);
      }
      start += entry.source.length + (layout.separators[index]?.length ?? 0);
    });
  }
  while (starts.length < count) {
    unit.push(-1);
    node.push(0);
    starts.push(layout ? text.length : 0);
  }
  return noteWith({ text, doc, frontmatter, layout, starts }, layout ? { layout, unit, node } : null);
}

export function noteUnitAt(note: SharedNote, at: number): { node: number; source: string } | null {
  const index = unitIndexes.get(note);
  if (!index) return null;
  const unit = index.unit[at] ?? -1;
  return unit < 0 ? { node: 0, source: "" } : { node: index.node[at], source: index.layout.units[unit].source };
}

function isEmptyBlock(node: ProseMirrorNode): boolean {
  return node.type.name === "paragraph" && node.content.size === 0;
}

function sameBlock(left: ProseMirrorNode, right: ProseMirrorNode): boolean {
  return left === right || markdownBlockKey(left) === markdownBlockKey(right);
}

function pairBlocks(target: readonly ProseMirrorNode[], removed: readonly number[], added: readonly number[], match: number[]): void {
  const filled = added.filter((index) => !isEmptyBlock(target[index]));
  const paired = filled.length === removed.length ? filled : added;
  paired.forEach((index, at) => {
    if (at < removed.length) match[index] = removed[at];
  });
}

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index);
}

export function matchBlocks(source: readonly ProseMirrorNode[], target: readonly ProseMirrorNode[]): number[] {
  const match = new Array<number>(target.length).fill(-1);
  let head = 0;
  while (head < source.length && head < target.length && sameBlock(source[head], target[head])) {
    match[head] = head;
    head += 1;
  }
  let sourceEnd = source.length;
  let targetEnd = target.length;
  while (sourceEnd > head && targetEnd > head && sameBlock(source[sourceEnd - 1], target[targetEnd - 1])) {
    sourceEnd -= 1;
    targetEnd -= 1;
    match[targetEnd] = sourceEnd;
  }
  if (head === sourceEnd || head === targetEnd) return match;
  const script = myersEditScript(source.slice(head, sourceEnd).map(markdownBlockKey), target.slice(head, targetEnd).map(markdownBlockKey));
  if (!script) {
    pairBlocks(target, range(head, sourceEnd), range(head, targetEnd), match);
    return match;
  }
  let removed: number[] = [];
  let added: number[] = [];
  for (const edit of script) {
    if (edit.kind === "same") {
      pairBlocks(target, removed, added, match);
      removed = [];
      added = [];
      for (let offset = 0; offset < edit.length; offset += 1) match[head + edit.newStart + offset] = head + edit.oldStart + offset;
    } else if (edit.kind === "del") {
      removed.push(...range(head + edit.oldStart, head + edit.oldStart + edit.length));
    } else {
      added.push(...range(head + edit.newStart, head + edit.newStart + edit.length));
    }
  }
  pairBlocks(target, removed, added, match);
  return match;
}

const alignments = new WeakMap<SharedNote, { doc: ProseMirrorNode; note: SharedNote }>();

export function alignSharedNote(note: SharedNote, doc: ProseMirrorNode): SharedNote {
  if (note.doc === doc) return note;
  const known = alignments.get(note);
  if (known?.doc === doc) return known.note;
  const match = matchBlocks(children(note.doc), children(doc));
  const starts = new Array<number>(match.length);
  let next = note.text.length;
  for (let at = match.length - 1; at >= 0; at -= 1) {
    const from = match[at];
    starts[at] = from >= 0 ? (note.starts[from] ?? next) : next;
    next = starts[at];
  }
  const index = unitIndexes.get(note);
  const fields = { text: note.text, doc, frontmatter: note.frontmatter, layout: note.layout, starts };
  const aligned = index
    ? noteWith(fields, {
        layout: index.layout,
        unit: match.map((from) => (from >= 0 ? (index.unit[from] ?? -1) : -1)),
        node: match.map((from) => (from >= 0 ? (index.node[from] ?? 0) : 0)),
      })
    : noteWith(fields, null, match.map((from) => (from >= 0 ? (note.sources[from] ?? "") : "")));
  alignments.set(note, { doc, note: aligned });
  return aligned;
}

const DEFINITION_START = String.raw`^[ \t]*(?:(?:>|[-*+]|\d{1,9}[.)])[ \t]*)*\[(?!\^[^\]\s[]+\]:)`;
const REFERENCE_DEFINITION = new RegExp(String.raw`${DEFINITION_START}(?:[^\][\\]|\\.)+\]:`, "mu");
const BLANK_LINE = /\n[ \t]*\n/u;

const definitions = new WeakMap<SharedNote, boolean>();

function definesLinks(note: SharedNote): boolean {
  let found = definitions.get(note);
  if (found === undefined) {
    found = REFERENCE_DEFINITION.test(note.text);
    definitions.set(note, found);
  }
  return found;
}

function unclosedComment(region: string): boolean {
  const opened = region.lastIndexOf("<!--");
  return opened >= 0 && !region.includes("-->", opened + 4);
}

function changesDocument(region: string): boolean {
  return unclosedComment(region) || REFERENCE_DEFINITION.test(region);
}

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
  let start = text.length - mappedLength(layout);
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
  return node !== undefined && isEmptyBlock(node);
}

function reparsedNote(schema: Schema, previous: SharedNote, text: string): SharedNote | null {
  const { layout } = previous;
  if (!layout || layout.units.length === 0 || definesLinks(previous)) return null;
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
  if (changesDocument(region) || changesDocument(previous.text.slice(regionStart, regionEnd))) return null;
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
  const note = sharedNoteOf(text, doc, previous.frontmatter, nextLayout);
  protectedRanges.set(note, now);
  definitions.set(note, false);
  return note;
}

export function parseSharedNote(schema: Schema, text: string, previous: SharedNote | null = null): SharedNote {
  if (previous?.text === text) return previous;
  const reparsed = previous ? reparsedNote(schema, previous, text) : null;
  if (reparsed) return reparsed;
  const parsed = parseNoteMarkdown(text);
  return sharedNoteOf(text, schema.nodeFromJSON(parsed.doc), parsed.frontmatter, parsed.layout);
}

const blockJson = new WeakMap<ProseMirrorNode, JSONContent>();
const snapshots = new WeakMap<SharedNote, MarkdownSourceSnapshot | null>();

function jsonOf(node: ProseMirrorNode): JSONContent {
  let json = blockJson.get(node);
  if (!json) {
    json = node.toJSON() as JSONContent;
    blockJson.set(node, json);
  }
  return json;
}

export function sharedNoteSnapshot(note: SharedNote): MarkdownSourceSnapshot | null {
  const known = snapshots.get(note);
  if (known !== undefined) return known;
  const blocks = children(note.doc);
  const snapshot = createMarkdownSourceSnapshot(note.layout, { type: "doc", content: blocks.map(jsonOf) }, blocks.map(markdownBlockKey));
  snapshots.set(note, snapshot);
  return snapshot;
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

export function noteDocTransaction(state: EditorState, target: ProseMirrorNode): Transaction | null {
  const current = state.doc;
  if (target.eq(current)) return null;
  const drafts = diffNoteDocs(current, target);
  let tr = state.tr;
  applyDrafts(tr, drafts);
  let placed: readonly NoteChangeDraft[] | null = drafts;
  if (!tr.doc.eq(target)) {
    tr = state.tr.replaceWith(0, current.content.size, target.content);
    placed = null;
  }
  keepSelection(tr, state.selection, current, placed);
  return tr.setMeta(NOTE_REMOTE, true).setMeta("addToHistory", false);
}

export function sharedNoteTransaction(state: EditorState, base: SharedNote | null, next: SharedNote): Transaction | null {
  return noteDocTransaction(state, base ? mergedDoc(base, state.doc, next) : next.doc);
}

export function showSharedNote(editor: Editor, base: SharedNote | null, next: SharedNote): void {
  const tr = sharedNoteTransaction(editor.state, base, next);
  if (tr) editor.view.dispatch(tr);
}

export function showNoteDoc(editor: Editor, target: ProseMirrorNode): void {
  const tr = noteDocTransaction(editor.state, target);
  if (tr) editor.view.dispatch(tr);
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
