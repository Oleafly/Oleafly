import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { type EditorState, NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { noteBlockName } from "./note-blocks";
import { serializeNoteMarkdown } from "./note-markdown";

export const COVERED_CLASS = "note-in-selection";
export const STRAY_SELECTION = "data-note-stray-selection";
export const SELECTING = "data-note-selecting";

export function selectingAttributes(state: EditorState): Record<string, string> {
  return state.selection.empty ? {} : { [SELECTING]: "" };
}

const selectionKey = new PluginKey<DecorationSet>("noteSelection");

export function selectsAsWhole(node: ProseMirrorNode): boolean {
  if (node.type.name === "codeBlock") return noteBlockName(String(node.attrs.language ?? "")) !== undefined;
  return node.isAtom && !node.isText && node.type.name !== "hardBreak";
}

export function coveredBlocks(state: EditorState): DecorationSet {
  const { selection, doc } = state;
  if (selection.empty || selection instanceof NodeSelection) return DecorationSet.empty;
  const covered: Decoration[] = [];
  for (const { $from, $to } of selection.ranges) {
    const from = $from.pos;
    const to = $to.pos;
    doc.nodesBetween(from, to, (node, pos) => {
      if (!selectsAsWhole(node)) return true;
      const end = pos + node.nodeSize;
      if (pos >= from && end <= to) covered.push(Decoration.node(pos, end, { class: COVERED_CLASS }));
      return false;
    });
  }
  return covered.length > 0 ? DecorationSet.create(doc, covered) : DecorationSet.empty;
}

const SOURCE_LEAVES = new Set(["mathInline", "rawInline"]);

function leafText(node: ProseMirrorNode): string {
  if (node.type.name === "hardBreak") return "\n";
  return SOURCE_LEAVES.has(node.type.name) ? String(node.attrs.source) : "";
}

export function singleTextblock(slice: Slice): ProseMirrorNode | null {
  if (slice.openStart === 0 || slice.openStart !== slice.openEnd) return null;
  let content = slice.content;
  for (let depth = 1; depth <= slice.openStart; depth += 1) {
    const only = content.childCount === 1 ? content.firstChild : null;
    if (!only) return null;
    if (only.isTextblock) return depth === slice.openStart ? only : null;
    content = only.content;
  }
  return null;
}

export type WholeNoteText = (doc: ProseMirrorNode) => string;

export function noteClipboardText(slice: Slice, doc: ProseMirrorNode, wholeNote: WholeNoteText | null = null): string {
  const textblock = singleTextblock(slice);
  if (textblock) return textblock.textBetween(0, textblock.content.size, "\n", leafText);
  const whole = slice.openStart === 0 && slice.openEnd === 0 && slice.content.eq(doc.content);
  const copied = whole ? doc : doc.type.createAndFill(null, slice.content);
  if (!copied) return "";
  const text = whole && wholeNote ? wholeNote(copied) : serializeNoteMarkdown(copied.toJSON());
  return text.replace(/\n+$/u, "");
}

function insideWidget(view: EditorView, node: Node | null): boolean {
  if (!node || !view.dom.contains(node)) return true;
  const element = node instanceof Element ? node : node.parentElement;
  const widget = element?.closest('[contenteditable="false"]');
  return Boolean(widget && widget !== view.dom && view.dom.contains(widget));
}

export function watchStraySelection(view: EditorView): { destroy(): void } {
  const owner = view.dom.ownerDocument;
  const sync = () => {
    const selection = owner.getSelection();
    const stray =
      !selection?.rangeCount ||
      insideWidget(view, selection.anchorNode) ||
      insideWidget(view, selection.focusNode);
    view.dom.toggleAttribute(STRAY_SELECTION, stray);
  };
  sync();
  owner.addEventListener("selectionchange", sync);
  return {
    destroy() {
      owner.removeEventListener("selectionchange", sync);
      view.dom.removeAttribute(STRAY_SELECTION);
    },
  };
}

export interface NoteSelectionOptions {
  wholeNote: WholeNoteText | null;
}

export const NoteSelection = Extension.create<NoteSelectionOptions>({
  name: "noteSelection",

  addOptions() {
    return { wholeNote: null };
  },

  addProseMirrorPlugins() {
    const { wholeNote } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: selectionKey,
        state: {
          init: (_config, state) => coveredBlocks(state),
          apply: (tr, value, old, state) => {
            if (!tr.docChanged && (!tr.selectionSet || old.selection.eq(state.selection))) return value;
            return coveredBlocks(state);
          },
        },
        props: {
          attributes: selectingAttributes,
          decorations: (state) => selectionKey.getState(state),
          clipboardTextSerializer: (slice, view) => noteClipboardText(slice, view.state.doc, wholeNote),
        },
        view: watchStraySelection,
      }),
    ];
  },
});
