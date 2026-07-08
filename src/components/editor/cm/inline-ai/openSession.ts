import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useInlineEditStore } from "@/store/inlineEdit";

/**
 * The range the inline AI edit should target: the selection if there is one,
 * otherwise the current line.
 */
export function resolveTargetRange(
  state: EditorState,
): { from: number; to: number; original: string } {
  const sel = state.selection.main;
  if (!sel.empty) {
    return { from: sel.from, to: sel.to, original: state.sliceDoc(sel.from, sel.to) };
  }
  const line = state.doc.lineAt(sel.head);
  return { from: line.from, to: line.to, original: line.text };
}

/** Open an inline AI edit session for the current selection / line. */
export function openInlineEdit(view: EditorView): void {
  if (useInlineEditStore.getState().session) return; // one session at a time
  const { from, to, original } = resolveTargetRange(view.state);
  if (!original.trim()) return;
  useInlineEditStore.getState().open({ from, to, original });
}
