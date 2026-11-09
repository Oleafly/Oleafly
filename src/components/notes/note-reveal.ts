import { markdownBlockAt } from "@oleafly/wysiwyg";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { markdownMathRanges } from "@/components/editor/wysiwyg/markdown-source";
import { blockCount, sourceOffset, type VisualLocation } from "@/components/editor/wysiwyg/reveal";
import { waitForNoteEditor } from "@/lib/open-note-editors";
import { noteMarkdownExtensions } from "./note-markdown";

export interface NoteRevealOptions {
  select: boolean;
  focus: boolean;
}

export function noteBlockPosition(doc: ProseMirrorNode, source: string, target: VisualLocation): number | null {
  const block = markdownBlockAt(source, sourceOffset(source, target), {
    preservedInlineRanges: markdownMathRanges(source),
    extensions: noteMarkdownExtensions(),
  });
  if (!block || block.count !== blockCount(doc)) return null;
  let pos = 0;
  for (let index = 0; index < block.index; index += 1) pos += doc.child(index).nodeSize;
  return pos;
}

export async function revealNoteLocation(
  noteId: string,
  source: string,
  target: VisualLocation,
  signal: AbortSignal,
  options: NoteRevealOptions,
): Promise<boolean> {
  const open = await waitForNoteEditor(noteId, signal);
  if (!open || signal.aborted || open.editor.isDestroyed) return false;
  const { editor } = open;
  const pos = noteBlockPosition(editor.state.doc, source, target);
  if (pos === null) return true;
  if (options.focus) editor.view.focus();
  if (options.select) {
    editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos))));
  }
  const block = editor.view.nodeDOM(pos);
  if (block instanceof HTMLElement) block.scrollIntoView?.({ block: "center" });
  return true;
}
