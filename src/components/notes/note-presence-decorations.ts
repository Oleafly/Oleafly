import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { NotePeerCaret, NotePeerMark } from "@/lib/collab-live-bridge";
import { cssText, labelLightness, REMOTE_CARET_COLOR, REMOTE_PART_STYLES, remoteLabelColor } from "@/lib/peer-colors";

export type { NotePeerCaret, NotePeerMark } from "@/lib/collab-live-bridge";

interface PlacedMark {
  id: string;
  name: string;
  hue: number;
  pos: number;
}

interface MarkState {
  marks: readonly PlacedMark[];
  decorations: DecorationSet;
}

const peerKey = new PluginKey<MarkState>("notePeerMarks");

function topStart(doc: ProseMirrorNode, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const resolved = doc.resolve(clamped);
  if (resolved.depth > 0) return resolved.before(1);
  const index = Math.min(resolved.index(0), doc.childCount - 1);
  let start = 0;
  for (let at = 0; at < index; at += 1) start += doc.child(at).nodeSize;
  return start;
}

function startOfBlock(doc: ProseMirrorNode, index: number): number {
  let start = 0;
  const last = Math.max(0, Math.min(index, doc.childCount - 1));
  for (let at = 0; at < last; at += 1) start += doc.child(at).nodeSize;
  return start;
}

function samePlaced(left: readonly PlacedMark[], right: readonly PlacedMark[]): boolean {
  return (
    left.length === right.length &&
    left.every((mark, index) => {
      const other = right[index];
      return mark.id === other.id && mark.name === other.name && mark.hue === other.hue && mark.pos === other.pos;
    })
  );
}

export function peerMarksOf(state: EditorState): readonly PlacedMark[] {
  return peerKey.getState(state)?.marks ?? [];
}

function mappedMarks(marks: readonly PlacedMark[], tr: Transaction): readonly PlacedMark[] {
  if (!tr.docChanged || marks.length === 0) return marks;
  return marks.map((mark) => ({ ...mark, pos: topStart(tr.doc, tr.mapping.map(mark.pos, 1)) }));
}

export function setNotePeerMarks(editor: Editor, marks: readonly NotePeerMark[], into?: Transaction): boolean {
  const tr = into ?? editor.state.tr;
  const previous = (tr.getMeta(peerKey) as PlacedMark[] | undefined) ?? mappedMarks(peerMarksOf(editor.state), tr);
  const placed = marks.map((mark) => ({ id: mark.id, name: mark.name, hue: mark.hue, pos: startOfBlock(tr.doc, mark.index) }));
  if (samePlaced(previous, placed)) return false;
  tr.setMeta(peerKey, placed).setMeta("addToHistory", false);
  if (!into) editor.view.dispatch(tr);
  return true;
}

function markElement(marks: readonly PlacedMark[]): HTMLElement {
  const root = document.createElement("span");
  root.contentEditable = "false";
  root.setAttribute("aria-hidden", "true");
  root.dataset.notePeers = marks.map((mark) => mark.id).join(" ");
  root.className = "pointer-events-none absolute -left-3.5 top-0.5 z-10 flex select-none gap-px";
  for (const mark of marks) {
    const hit = document.createElement("span");
    hit.className = "group/peer pointer-events-auto relative flex h-5 w-1.5 justify-center";
    const bar = document.createElement("span");
    bar.className = "block h-full w-1 rounded-full";
    bar.style.setProperty("--remote-hue", String(mark.hue));
    bar.style.backgroundColor = REMOTE_CARET_COLOR;
    const name = document.createElement("span");
    name.dataset.notePeerName = mark.id;
    name.className =
      "pointer-events-none absolute bottom-full left-0 mb-1 hidden whitespace-nowrap rounded px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4 text-white group-hover/peer:block";
    name.style.backgroundColor = remoteLabelColor(mark.hue);
    name.textContent = mark.name;
    hit.append(bar, name);
    root.append(hit);
  }
  return root;
}

function decorationsFor(doc: ProseMirrorNode, marks: readonly PlacedMark[]): DecorationSet {
  if (marks.length === 0) return DecorationSet.empty;
  const byBlock = new Map<number, PlacedMark[]>();
  for (const mark of marks) byBlock.set(mark.pos, [...(byBlock.get(mark.pos) ?? []), mark]);
  const decorations: Decoration[] = [];
  for (const [pos, group] of byBlock) {
    const node = doc.nodeAt(pos);
    if (!node || node.isLeaf) continue;
    const key = group.map((mark) => `${mark.id}:${mark.hue}:${mark.name}`).join("|");
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, { class: "relative" }),
      Decoration.widget(pos + 1, () => markElement(group), { key, side: -1, ignoreSelection: true }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

export interface PlacedCaret {
  id: string;
  name: string | null;
  hue: number;
  head: number;
  anchor: number;
  reported: { head: number; anchor: number };
}

interface CaretState {
  carets: readonly PlacedCaret[];
  decorations: DecorationSet;
}

const caretKey = new PluginKey<CaretState>("notePeerCarets");

export function peerCaretsOf(state: EditorState): readonly PlacedCaret[] {
  return caretKey.getState(state)?.carets ?? [];
}

function clampPos(doc: ProseMirrorNode, pos: number): number {
  return Math.max(0, Math.min(Number.isFinite(pos) ? Math.trunc(pos) : 0, doc.content.size));
}

function sameCarets(left: readonly PlacedCaret[], right: readonly PlacedCaret[]): boolean {
  return (
    left.length === right.length &&
    left.every((caret, index) => {
      const other = right[index];
      return (
        caret.id === other.id &&
        caret.name === other.name &&
        caret.hue === other.hue &&
        caret.head === other.head &&
        caret.anchor === other.anchor &&
        caret.reported.head === other.reported.head &&
        caret.reported.anchor === other.reported.anchor
      );
    })
  );
}

const NONE: ReadonlySet<string> = new Set();

export function placeNotePeerCarets(
  doc: ProseMirrorNode,
  previous: readonly PlacedCaret[],
  carets: readonly NotePeerCaret[],
  place: (offset: number) => number,
  replace: ReadonlySet<string> = NONE,
): PlacedCaret[] {
  const kept = new Map(previous.map((caret) => [caret.id, caret]));
  return carets.map((caret) => {
    const reported = { head: caret.head, anchor: caret.anchor };
    const before = kept.get(caret.id);
    if (before && !replace.has(caret.id) && before.reported.head === caret.head && before.reported.anchor === caret.anchor) {
      return { ...before, name: caret.name, hue: caret.hue };
    }
    const head = clampPos(doc, place(caret.head));
    const anchor = caret.anchor === caret.head ? head : clampPos(doc, place(caret.anchor));
    return { id: caret.id, name: caret.name, hue: caret.hue, head, anchor, reported };
  });
}

function mappedCarets(carets: readonly PlacedCaret[], tr: Transaction): readonly PlacedCaret[] {
  if (!tr.docChanged || carets.length === 0) return carets;
  return carets.map((caret) => ({
    ...caret,
    head: tr.mapping.map(caret.head, -1),
    anchor: tr.mapping.map(caret.anchor, -1),
  }));
}

export function setNotePeerCarets(
  editor: Editor,
  carets: readonly NotePeerCaret[],
  place: (offset: number) => number,
  replace: ReadonlySet<string> = NONE,
  into?: Transaction,
): boolean {
  const tr = into ?? editor.state.tr;
  const previous = (tr.getMeta(caretKey) as PlacedCaret[] | undefined) ?? mappedCarets(peerCaretsOf(editor.state), tr);
  const placed = placeNotePeerCarets(tr.doc, previous, carets, place, replace);
  if (sameCarets(previous, placed)) return false;
  tr.setMeta(caretKey, placed).setMeta("addToHistory", false);
  if (!into) editor.view.dispatch(tr);
  return true;
}

function caretElement(caret: PlacedCaret): HTMLElement {
  const root = document.createElement("span");
  root.className = "note-remote-caret";
  root.setAttribute("contenteditable", "false");
  root.setAttribute("aria-hidden", "true");
  root.dataset.notePeerCaret = caret.id;
  Object.assign(root.style, REMOTE_PART_STYLES.caret);
  root.style.setProperty("--remote-hue", String(caret.hue));
  if (caret.name) {
    const label = document.createElement("span");
    label.className = "note-remote-caret-label";
    Object.assign(label.style, REMOTE_PART_STYLES.label);
    label.style.setProperty("--remote-label-lightness", `${labelLightness(caret.hue)}%`);
    label.textContent = caret.name;
    root.append(label);
  }
  return root;
}

function caretDecorations(doc: ProseMirrorNode, carets: readonly PlacedCaret[]): DecorationSet {
  if (carets.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  for (const caret of carets) {
    const from = Math.min(caret.head, caret.anchor);
    const to = Math.max(caret.head, caret.anchor);
    if (from < to) {
      decorations.push(
        Decoration.inline(from, to, {
          class: "note-remote-selection",
          style: `--remote-hue: ${caret.hue}; ${cssText(REMOTE_PART_STYLES.selection)}`,
        }),
      );
    }
    decorations.push(
      Decoration.widget(caret.head, () => caretElement(caret), {
        key: `caret:${caret.id}:${caret.hue}:${caret.name ?? ""}`,
        side: -1,
        ignoreSelection: true,
      }),
    );
  }
  return DecorationSet.create(doc, decorations);
}

export const NotePeerMarks = Extension.create({
  name: "notePeerMarks",

  addProseMirrorPlugins() {
    return [
      new Plugin<MarkState>({
        key: peerKey,
        state: {
          init: () => ({ marks: [], decorations: DecorationSet.empty }),
          apply(tr, value) {
            const next = tr.getMeta(peerKey) as PlacedMark[] | undefined;
            if (next) return { marks: next, decorations: decorationsFor(tr.doc, next) };
            if (!tr.docChanged || value.marks.length === 0) return value;
            const marks = mappedMarks(value.marks, tr);
            return { marks, decorations: decorationsFor(tr.doc, marks) };
          },
        },
        props: {
          decorations: (state) => peerKey.getState(state)?.decorations,
        },
      }),
      new Plugin<CaretState>({
        key: caretKey,
        state: {
          init: () => ({ carets: [], decorations: DecorationSet.empty }),
          apply(tr, value) {
            const next = tr.getMeta(caretKey) as PlacedCaret[] | undefined;
            if (next) return { carets: next, decorations: caretDecorations(tr.doc, next) };
            if (!tr.docChanged || value.carets.length === 0) return value;
            const carets = mappedCarets(value.carets, tr);
            return { carets, decorations: caretDecorations(tr.doc, carets) };
          },
        },
        props: {
          decorations: (state) => caretKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
