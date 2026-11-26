import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { commentMarkStyle } from "@/components/ui/comments/comment-mark-styles";
import { type NoteCommentRange, openNoteComment } from "@/lib/collab-live-bridge";
import { cssText } from "@/lib/peer-colors";
import { scrollBehavior } from "@/lib/reduced-motion";

export interface PlacedComment extends NoteCommentRange {
  id: string;
  resolved: boolean;
}

export interface PlacedComments {
  spans: readonly PlacedComment[];
  selected: string | null;
  draft: NoteCommentRange | null;
}

interface CommentState extends PlacedComments {
  decorations: DecorationSet;
}

const NONE: PlacedComments = { spans: [], selected: null, draft: null };
const commentKey = new PluginKey<CommentState>("noteCommentMarks");
const SVG = "http://www.w3.org/2000/svg";

const RANGE_STYLE = cssText(commentMarkStyle(false));
const ACTIVE_STYLE = cssText(commentMarkStyle(true));

function clamp(doc: ProseMirrorNode, pos: number): number {
  return Math.max(0, Math.min(Number.isFinite(pos) ? Math.trunc(pos) : 0, doc.content.size));
}

function ordered(doc: ProseMirrorNode, range: NoteCommentRange): NoteCommentRange {
  const from = clamp(doc, range.from);
  const to = clamp(doc, range.to);
  return from <= to ? { from, to } : { from: to, to: from };
}

function mapRange(range: NoteCommentRange, tr: Transaction): NoteCommentRange {
  const from = tr.mapping.map(range.from, 1);
  return { from, to: Math.max(from, tr.mapping.map(range.to, -1)) };
}

function mapped(value: PlacedComments, tr: Transaction): PlacedComments {
  if (!tr.docChanged) return value;
  return {
    spans: value.spans.map((span) => ({ ...span, ...mapRange(span, tr) })),
    selected: value.selected,
    draft: value.draft ? mapRange(value.draft, tr) : null,
  };
}

function topStart(doc: ProseMirrorNode, pos: number): number | null {
  const resolved = doc.resolve(clamp(doc, pos));
  return resolved.depth > 0 ? resolved.before(1) : null;
}

function markerIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M7.9 20A9 9 0 1 0 4 16.1L2 22Z");
  svg.append(path);
  return svg;
}

function markerElement(ids: readonly string[], active: boolean): HTMLElement {
  const root = document.createElement("button");
  root.type = "button";
  root.contentEditable = "false";
  root.tabIndex = -1;
  root.dataset.noteCommentMarker = ids.join(" ");
  root.className =
    "absolute -right-9 top-0.5 z-10 flex h-5 select-none items-center gap-0.5 rounded px-1 text-[0.6875rem] font-medium leading-none transition-colors hover:bg-accent focus-visible:bg-accent";
  root.style.color = "var(--comment-active-underline)";
  if (active) root.style.backgroundColor = "var(--comment-active)";
  const icon = markerIcon();
  icon.setAttribute("class", "size-3.5 shrink-0");
  root.append(icon);
  if (ids.length > 1) root.append(String(ids.length));
  root.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openNoteComment(ids[0], "marker");
  });
  return root;
}

function rangeDecorations(doc: ProseMirrorNode, value: PlacedComments): { ranges: Decoration[]; byBlock: Map<number, string[]> } {
  const ranges: Decoration[] = [];
  const byBlock = new Map<number, string[]>();
  for (const span of value.spans.filter((entry) => !entry.resolved)) {
    const { from, to } = ordered(doc, span);
    const style = span.id === value.selected ? ACTIVE_STYLE : RANGE_STYLE;
    if (from < to) ranges.push(Decoration.inline(from, to, { style, "data-note-comment": span.id }, { id: span.id }));
    const block = topStart(doc, from);
    if (block !== null) byBlock.set(block, [...(byBlock.get(block) ?? []), span.id]);
  }
  return { ranges, byBlock };
}

function draftDecoration(doc: ProseMirrorNode, draft: NoteCommentRange | null): Decoration[] {
  if (!draft) return [];
  const { from, to } = ordered(doc, draft);
  return from < to ? [Decoration.inline(from, to, { style: ACTIVE_STYLE, "data-note-comment-draft": "true" })] : [];
}

function markerDecorations(doc: ProseMirrorNode, byBlock: ReadonlyMap<number, string[]>, selected: string | null): Decoration[] {
  const markers: Decoration[] = [];
  for (const [pos, ids] of byBlock) {
    const node = doc.nodeAt(pos);
    if (!node || node.isLeaf) continue;
    const active = selected !== null && ids.includes(selected);
    markers.push(
      Decoration.node(pos, pos + node.nodeSize, { class: "relative" }),
      Decoration.widget(pos + 1, () => markerElement(ids, active), {
        key: `comments:${ids.join(",")}:${active ? 1 : 0}`,
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
  }
  return markers;
}

function decorationsFor(doc: ProseMirrorNode, value: PlacedComments): DecorationSet {
  const { ranges, byBlock } = rangeDecorations(doc, value);
  const decorations = [...ranges, ...draftDecoration(doc, value.draft), ...markerDecorations(doc, byBlock, value.selected)];
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations);
}

function insideTextblocks(tr: Transaction): boolean {
  return tr.steps.every((step, index) => {
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return true;
    if (!(step instanceof ReplaceStep) || step.slice.openStart > 0 || step.slice.openEnd > 0) return false;
    const doc = tr.docs[index];
    const from = doc.resolve(step.from);
    let inline = true;
    step.slice.content.forEach((node) => {
      inline &&= node.isInline;
    });
    return inline && from.parent.isTextblock && from.sameParent(doc.resolve(step.to));
  });
}

function sameComments(left: PlacedComments, right: PlacedComments): boolean {
  if (left.selected !== right.selected) return false;
  if ((left.draft === null) !== (right.draft === null)) return false;
  if (left.draft && right.draft && (left.draft.from !== right.draft.from || left.draft.to !== right.draft.to)) return false;
  return (
    left.spans.length === right.spans.length &&
    left.spans.every((span, index) => {
      const other = right.spans[index];
      return span.id === other.id && span.from === other.from && span.to === other.to && span.resolved === other.resolved;
    })
  );
}

export function noteCommentsOf(state: EditorState): PlacedComments {
  const value = commentKey.getState(state);
  return value ? { spans: value.spans, selected: value.selected, draft: value.draft } : NONE;
}

export function setNoteComments(editor: Editor, next: PlacedComments, into?: Transaction): boolean {
  const tr = into ?? editor.state.tr;
  const previous = (tr.getMeta(commentKey) as PlacedComments | undefined) ?? mapped(noteCommentsOf(editor.state), tr);
  if (sameComments(previous, next)) return false;
  tr.setMeta(commentKey, next).setMeta("addToHistory", false);
  if (!into) editor.view.dispatch(tr);
  return true;
}

export function revealNoteComment(editor: Editor, threadId: string): boolean {
  if (editor.isDestroyed) return false;
  const span = noteCommentsOf(editor.state).spans.find((entry) => entry.id === threadId);
  if (!span) return false;
  const { from } = ordered(editor.state.doc, span);
  const { node } = editor.view.domAtPos(from);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  element?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  return true;
}

function threadAt(view: EditorView, pos: number): string | null {
  const { spans } = noteCommentsOf(view.state);
  let best: PlacedComment | null = null;
  for (const span of spans) {
    if (span.resolved) continue;
    const { from, to } = ordered(view.state.doc, span);
    if (pos < from || pos > to || from === to) continue;
    if (!best || to - from < best.to - best.from) best = { ...span, from, to };
  }
  return best?.id ?? null;
}

export const NoteCommentMarks = Extension.create({
  name: "noteCommentMarks",

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentState>({
        key: commentKey,
        state: {
          init: () => ({ ...NONE, decorations: DecorationSet.empty }),
          apply(tr, value) {
            const next = tr.getMeta(commentKey) as PlacedComments | undefined;
            if (next) return { ...next, decorations: decorationsFor(tr.doc, next) };
            if (!tr.docChanged || (value.spans.length === 0 && value.draft === null)) return value;
            const moved = mapped(value, tr);
            const decorations = insideTextblocks(tr) ? value.decorations.map(tr.mapping, tr.doc) : decorationsFor(tr.doc, moved);
            return { ...moved, decorations };
          },
        },
        props: {
          decorations: (state) => commentKey.getState(state)?.decorations,
          handleClick: (view, pos) => {
            const id = threadAt(view, pos);
            if (id) openNoteComment(id, "text");
            return false;
          },
        },
      }),
    ];
  },
});
