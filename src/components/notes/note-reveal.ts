import { Selection } from "@tiptap/pm/state";
import { blockPosition, type VisualLocation } from "@/components/editor/wysiwyg/reveal";
import { waitForNoteEditor } from "@/lib/open-note-editors";
import { noteMarkdownExtensions } from "./note-markdown";

export interface NoteRevealOptions {
  select: boolean;
  focus: boolean;
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
  const pos = blockPosition(editor.state.doc, source, target, noteMarkdownExtensions());
  if (pos === null) return true;
  if (options.focus) editor.view.focus();
  if (options.select) {
    editor.view.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(pos))));
  }
  const block = editor.view.nodeDOM(pos);
  if (block instanceof HTMLElement) block.scrollIntoView?.({ block: "center" });
  return true;
}
