import { markdownBlockAt } from "@oleafly/wysiwyg";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useFilesStore } from "@/store/files";
import { waitForWysiwygDocument } from "./controller";
import { markdownMathRanges } from "./markdown-source";

export interface VisualLocation {
  path: string;
  line?: number;
  range?: { from: number; to: number };
}

function sourceOffset(source: string, target: VisualLocation): number {
  if (target.range) return Math.min(Math.max(0, target.range.from), source.length);
  let offset = 0;
  for (let line = 1; line < (target.line ?? 1); line++) {
    const next = source.indexOf("\n", offset);
    if (next < 0) return source.length;
    offset = next + 1;
  }
  return offset;
}

function blockCount(doc: ProseMirrorNode): number {
  const last = doc.lastChild;
  return last?.type.name === "paragraph" && last.childCount === 0
    ? doc.childCount - 1
    : doc.childCount;
}

function centreBlock(editor: Editor, pos: number) {
  const scroller = editor.view.dom.closest<HTMLElement>(".wysiwyg-content");
  const block = editor.view.nodeDOM(pos);
  if (!scroller || !(block instanceof HTMLElement)) return;
  const box = block.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  scroller.scrollTop += box.top - viewport.top - Math.max(0, (viewport.height - box.height) / 2);
}

/**
 * Shows a Markdown source location in the Visual editor: it waits for the
 * editor to load the file, finds the top-level block that holds the location
 * and centres it. Returns false when the editor's blocks do not line up with
 * the source, so the caller can show the location in Code instead.
 */
export async function revealVisualLocation(
  target: VisualLocation,
  signal: AbortSignal,
  options: { select: boolean; focus: boolean },
): Promise<boolean> {
  const editor = await waitForWysiwygDocument(target.path, signal);
  if (!editor || editor.isDestroyed || signal.aborted) return false;
  const source = useFilesStore.getState().files[target.path]?.content;
  if (source === undefined) return false;
  const block = markdownBlockAt(source, sourceOffset(source, target), {
    preservedInlineRanges: markdownMathRanges(source),
  });
  const { doc } = editor.state;
  if (block?.count !== blockCount(doc)) return false;
  let pos = 0;
  for (let index = 0; index < block.index; index++) pos += doc.child(index).nodeSize;
  if (options.focus) editor.view.focus();
  if (options.select) {
    editor.view.dispatch(editor.state.tr.setSelection(Selection.near(doc.resolve(pos))));
  }
  centreBlock(editor, pos);
  return true;
}
