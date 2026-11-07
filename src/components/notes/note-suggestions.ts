import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { DOMSerializer, Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NoteChangeDraft } from "./note-diff";

export type ChangeOrigin = "agent" | "disk";

type NoteChange = NoteChangeDraft & { id: string; origin: ChangeOrigin };

interface ReviewState {
  items: NoteChange[];
  activeId: string | null;
}

export interface ReviewSummary {
  count: number;
  index: number;
  activeId: string | null;
}

const reviewKey = new PluginKey<ReviewState>("noteSuggestions");
const EMPTY: ReviewState = { items: [], activeId: null };
let nextId = 0;

function review(editor: Editor): ReviewState {
  return reviewKey.getState(editor.state) ?? EMPTY;
}

export function reviewSummary(editor: Editor): ReviewSummary {
  const { items, activeId } = review(editor);
  return { count: items.length, index: items.findIndex((item) => item.id === activeId), activeId };
}

export function showSuggestions(editor: Editor, drafts: readonly NoteChangeDraft[], origin: ChangeOrigin): void {
  const { items: current, activeId } = review(editor);
  const fresh = drafts.map((draft) => ({ ...draft, id: `change-${++nextId}`, origin }));
  const items = [...current.filter((item) => item.origin !== origin), ...fresh].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
  const keep = items.some((item) => item.id === activeId) && origin === "disk";
  editor.view.dispatch(
    editor.state.tr.setMeta(reviewKey, { items, activeId: keep ? activeId : (fresh[0]?.id ?? items[0]?.id ?? null) }),
  );
}

export function isReviewTransaction(tr: Transaction): boolean {
  return tr.getMeta(reviewKey) !== undefined;
}

export function hasPending(editor: Editor, origin: ChangeOrigin): boolean {
  return review(editor).items.some((item) => item.origin === origin);
}

export function docWithPending(editor: Editor, origin: ChangeOrigin): ProseMirrorNode {
  const { tr } = editor.state;
  const pending = review(editor).items.filter((item) => item.origin === origin);
  for (const item of [...pending].reverse()) apply(tr, item);
  return tr.doc;
}

export function moveReview(editor: Editor, step: number): void {
  const { items, activeId } = review(editor);
  if (items.length === 0) return;
  const index = items.findIndex((item) => item.id === activeId);
  const target = items[(index + step + items.length) % items.length];
  editor.view.dispatch(editor.state.tr.setMeta(reviewKey, { items, activeId: target.id }));
}

function apply(tr: Transaction, item: NoteChange): void {
  const from = tr.mapping.map(item.from, 1);
  const to = Math.max(from, tr.mapping.map(item.to, -1));
  if (item.kind === "text") tr.insertText(item.text, from, to);
  else tr.replaceWith(from, to, Fragment.from(item.nodes));
}

function settle(editor: Editor, ids: ReadonlySet<string>, accept: boolean): void {
  const { items, activeId } = review(editor);
  const { tr } = editor.state;
  if (accept) {
    for (const item of [...items].filter((candidate) => ids.has(candidate.id)).reverse()) apply(tr, item);
  }
  const left = items
    .filter((item) => !ids.has(item.id))
    .map((item) => ({ ...item, from: tr.mapping.map(item.from, 1), to: tr.mapping.map(item.to, -1) }))
    .map((item) => ({ ...item, to: Math.max(item.from, item.to) }));
  const removedIndex = items.findIndex((item) => item.id === activeId);
  const next = (left[Math.min(removedIndex, left.length - 1)] ?? left[0])?.id ?? null;
  editor.view.dispatch(tr.setMeta(reviewKey, { items: left, activeId: next }));
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

function mapItems(tr: Transaction, state: ReviewState): ReviewState {
  const items = state.items
    .filter((item) => item.from === item.to || !touches(tr, item.from, item.to))
    .map((item) => {
      const from = tr.mapping.map(item.from, 1);
      return { ...item, from, to: Math.max(from, tr.mapping.map(item.to, -1)) };
    });
  const activeId = items.some((item) => item.id === state.activeId) ? state.activeId : (items[0]?.id ?? null);
  return { items, activeId };
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
  element.append(DOMSerializer.fromSchema(state.schema).serializeFragment(Fragment.from(nodes)));
  return element;
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
    if (position >= item.from && position + node.nodeSize <= item.to) {
      out.push(Decoration.node(position, position + node.nodeSize, { class: `note-diff-delete-block${suffix}` }));
    }
    return false;
  });
  if (item.nodes.length > 0) {
    out.push(
      Decoration.widget(item.to, () => insertedBlocks(state, item.nodes, active), {
        key: `${item.id}-${active}`,
        side: -1,
      }),
    );
  }
  return out;
}

export const NoteSuggestions = Extension.create({
  name: "noteSuggestions",

  addKeyboardShortcuts() {
    const settleActive = (accept: boolean) => {
      if (!review(this.editor).activeId) return false;
      if (accept) acceptActive(this.editor);
      else rejectActive(this.editor);
      return true;
    };
    return {
      "Mod-Enter": () => settleActive(true),
      Escape: () => settleActive(false),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ReviewState>({
        key: reviewKey,
        state: {
          init: () => EMPTY,
          apply(tr, state) {
            const next = tr.getMeta(reviewKey) as ReviewState | undefined;
            if (next) return next;
            if (!tr.docChanged || state.items.length === 0) return state;
            return mapItems(tr, state);
          },
        },
        props: {
          decorations(state) {
            const { items, activeId } = reviewKey.getState(state) ?? EMPTY;
            if (items.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              items.flatMap((item) => decorationsFor(state, item, item.id === activeId)),
            );
          },
        },
      }),
    ];
  },
});
