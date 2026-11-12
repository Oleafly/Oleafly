import { type Editor, Extension } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Transform } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { diffNoteDocs, type NoteChangeDraft } from "./note-diff";
import { destroyRemoteImageNotices, remoteSafeSerializer } from "./note-remote-images";

export type ChangeOrigin = "agent" | "disk";

type NoteChange = NoteChangeDraft & { id: string; origin: ChangeOrigin };

interface ReviewSnapshot {
  items: NoteChange[];
  activeId: string | null;
}

interface ReviewState extends ReviewSnapshot {
  undo: ReviewSnapshot | null;
  decorations: DecorationSet;
}

interface ReviewMeta extends ReviewSnapshot {
  undo?: ReviewSnapshot | null;
  navigate?: boolean;
  shown?: boolean;
}

export interface ReviewSummary {
  count: number;
  index: number;
  activeId: string | null;
}

const reviewKey = new PluginKey<ReviewState>("noteSuggestions");
const EMPTY: ReviewState = { items: [], activeId: null, undo: null, decorations: DecorationSet.empty };
let nextId = 0;

function review(editor: Editor): ReviewState {
  return reviewKey.getState(editor.state) ?? EMPTY;
}

function dispatchReview(editor: Editor, tr: Transaction, meta: ReviewMeta): void {
  editor.view.dispatch(tr.setMeta(reviewKey, meta));
}

export function reviewSummary(editor: Editor): ReviewSummary {
  const { items, activeId } = review(editor);
  return { count: items.length, index: items.findIndex((item) => item.id === activeId), activeId };
}

function withIds(drafts: readonly NoteChangeDraft[], origin: ChangeOrigin, firstId?: string): NoteChange[] {
  return drafts.map((draft, index) => ({ ...draft, id: index === 0 && firstId ? firstId : `change-${++nextId}`, origin }));
}

const overlapping = (left: NoteChangeDraft, right: NoteChangeDraft) => left.from < right.to && right.from < left.to;

export function showSuggestions(editor: Editor, drafts: readonly NoteChangeDraft[], origin: ChangeOrigin, add = false): void {
  const { items: current, activeId } = review(editor);
  const fresh = withIds(drafts, origin);
  const kept = current.filter(
    (item) => item.origin !== origin || (add && !fresh.some((draft) => overlapping(item, draft))),
  );
  const items = [...kept, ...fresh].sort((left, right) => left.from - right.from || left.to - right.to);
  const keep = items.some((item) => item.id === activeId) && (origin === "disk" || add);
  const active = keep ? activeId : (fresh[0]?.id ?? items[0]?.id ?? null);
  dispatchReview(editor, editor.state.tr, { items, activeId: active, undo: null, shown: true });
}

export function isReviewTransaction(tr: Transaction): boolean {
  const meta = tr.getMeta(reviewKey) as ReviewMeta | undefined;
  return meta !== undefined && meta.shown !== true;
}

export function isReviewNavigation(tr: Transaction): boolean {
  return (tr.getMeta(reviewKey) as ReviewMeta | undefined)?.navigate === true;
}

export function canUndoReject(editor: Editor): boolean {
  return review(editor).undo !== null;
}

export function undoReject(editor: Editor): boolean {
  const { undo } = review(editor);
  if (!undo) return false;
  dispatchReview(editor, editor.state.tr, { ...undo, undo: null, navigate: true });
  return true;
}

export function hasPending(editor: Editor, origin: ChangeOrigin): boolean {
  return review(editor).items.some((item) => item.origin === origin);
}

export function docWithPending(editor: Editor, origin: ChangeOrigin): ProseMirrorNode {
  const { tr } = editor.state;
  const pending = review(editor).items.filter((item) => item.origin === origin);
  for (const item of [...pending].reverse()) applyDraft(tr, item);
  return tr.doc;
}

export function moveReview(editor: Editor, step: number): void {
  const { items, activeId, undo } = review(editor);
  if (items.length === 0) return;
  const index = items.findIndex((item) => item.id === activeId);
  const target = items[(index + step + items.length) % items.length];
  dispatchReview(editor, editor.state.tr, { items, activeId: target.id, undo, navigate: true });
}

export function applyDraft(tr: Transform, item: NoteChangeDraft): void {
  const from = tr.mapping.map(item.from, 1);
  const to = Math.max(from, tr.mapping.map(item.to, -1));
  if (item.kind === "blocks") tr.replaceWith(from, to, Fragment.from(item.nodes));
  else if (item.text) tr.replaceWith(from, to, tr.doc.type.schema.text(item.text, item.marks ?? tr.doc.resolve(from).marks()));
  else tr.delete(from, to);
}

function settle(editor: Editor, ids: ReadonlySet<string>, accept: boolean): void {
  const { items, activeId } = review(editor);
  const { tr } = editor.state;
  if (accept) {
    for (const item of [...items].filter((candidate) => ids.has(candidate.id)).reverse()) applyDraft(tr, item);
  }
  const left = items
    .filter((item) => !ids.has(item.id))
    .map((item) => ({ ...item, from: tr.mapping.map(item.from, 1), to: tr.mapping.map(item.to, -1) }))
    .map((item) => ({ ...item, to: Math.max(item.from, item.to) }));
  const removedIndex = items.findIndex((item) => item.id === activeId);
  const next = (left[Math.min(removedIndex, left.length - 1)] ?? left[0])?.id ?? null;
  dispatchReview(editor, tr, { items: left, activeId: next, undo: accept ? null : { items, activeId }, navigate: true });
}

export function acceptActive(editor: Editor): void {
  const { activeId } = review(editor);
  if (activeId) settle(editor, new Set([activeId]), true);
}

export function rejectActive(editor: Editor): void {
  const { activeId } = review(editor);
  if (activeId) settle(editor, new Set([activeId]), false);
}

export function acceptAll(editor: Editor): void {
  settle(editor, new Set(review(editor).items.map((item) => item.id)), true);
}

export function rejectAll(editor: Editor): void {
  settle(editor, new Set(review(editor).items.map((item) => item.id)), false);
}

function touches(tr: Transaction, from: number, to: number): boolean {
  let start = from;
  let end = to;
  let hit = false;
  for (const map of tr.mapping.maps) {
    map.forEach((oldStart, oldEnd) => {
      if (oldStart < end && oldEnd > start) hit = true;
      if (oldStart === oldEnd && oldStart > start && oldStart < end) hit = true;
    });
    start = map.map(start, 1);
    end = Math.max(start, map.map(end, -1));
  }
  return hit;
}

function rediffed(doc: ProseMirrorNode, item: NoteChange): NoteChange[] {
  const target = new Transform(doc);
  applyDraft(target, item);
  return withIds(diffNoteDocs(doc, target.doc), item.origin, item.id);
}

function mapItems(tr: Transaction, state: ReviewSnapshot): ReviewSnapshot & { touched: boolean } {
  let touched = false;
  const items = state.items.flatMap((item) => {
    const from = tr.mapping.map(item.from, 1);
    const moved = { ...item, from, to: Math.max(from, tr.mapping.map(item.to, -1)) };
    if (item.from === item.to || !touches(tr, item.from, item.to)) return [moved];
    touched = true;
    return rediffed(tr.doc, moved);
  });
  const activeId = items.some((item) => item.id === state.activeId) ? state.activeId : (items[0]?.id ?? null);
  return { items, activeId, touched };
}

function insertedText(item: NoteChange & { kind: "text" }, active: boolean): HTMLElement {
  const element = document.createElement("span");
  element.className = active ? "note-diff-insert note-diff-active" : "note-diff-insert";
  element.textContent = item.text;
  return element;
}

function insertedBlocks(state: EditorState, nodes: readonly ProseMirrorNode[], active: boolean): HTMLElement {
  const element = document.createElement("div");
  element.className = active ? "note-diff-block note-diff-active" : "note-diff-block";
  element.contentEditable = "false";
  element.append(remoteSafeSerializer(state.schema).serializeFragment(Fragment.from(nodes)));
  return element;
}

function insideButton(event: Event): boolean {
  return event.target instanceof Element && event.target.closest("button") !== null;
}

function decorationsFor(state: EditorState, item: NoteChange, active: boolean): Decoration[] {
  const suffix = active ? " note-diff-active" : "";
  const out: Decoration[] = [];
  if (item.kind === "text") {
    if (item.from < item.to) out.push(Decoration.inline(item.from, item.to, { class: `note-diff-delete${suffix}` }));
    if (item.text) {
      out.push(Decoration.widget(item.to, () => insertedText(item, active), { key: `${item.id}-${active}`, side: 1 }));
    }
    return out;
  }
  state.doc.nodesBetween(item.from, item.to, (node, position) => {
    if (position < item.from || position + node.nodeSize > item.to) return true;
    out.push(Decoration.node(position, position + node.nodeSize, { class: `note-diff-delete-block${suffix}` }));
    return false;
  });
  if (item.nodes.length > 0) {
    out.push(
      Decoration.widget(item.to, () => insertedBlocks(state, item.nodes, active), {
        key: `${item.id}-${active}`,
        side: -1,
        stopEvent: insideButton,
        destroy: destroyRemoteImageNotices,
      }),
    );
  }
  return out;
}

function buildDecorations(state: EditorState, items: readonly NoteChange[], activeId: string | null): DecorationSet {
  if (items.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    items.flatMap((item) => decorationsFor(state, item, item.id === activeId)),
  );
}

function nextReview(tr: Transaction, state: ReviewState, next: EditorState): ReviewState {
  const meta = tr.getMeta(reviewKey) as ReviewMeta | undefined;
  if (meta) {
    return { items: meta.items, activeId: meta.activeId, undo: meta.undo ?? null, decorations: buildDecorations(next, meta.items, meta.activeId) };
  }
  if (!tr.docChanged) return state;
  if (state.items.length === 0) return state.undo ? { ...state, undo: null } : state;
  const { touched, ...mapped } = mapItems(tr, state);
  const kept = !touched && mapped.activeId === state.activeId && mapped.items.length === state.items.length;
  return {
    ...mapped,
    undo: null,
    decorations: kept ? state.decorations.map(tr.mapping, tr.doc) : buildDecorations(next, mapped.items, mapped.activeId),
  };
}

const NoteSuggestionUndo = Extension.create({
  name: "noteSuggestionUndo",
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      "Mod-z": () => undoReject(this.editor),
    };
  },
});

export const NoteSuggestions = Extension.create({
  name: "noteSuggestions",

  addExtensions() {
    return [NoteSuggestionUndo];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        if (!review(this.editor).activeId) return false;
        acceptActive(this.editor);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ReviewState>({
        key: reviewKey,
        state: {
          init: () => EMPTY,
          apply: (tr, state, _old, next) => nextReview(tr, state, next),
        },
        props: {
          decorations: (state) => reviewKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ];
  },
});
