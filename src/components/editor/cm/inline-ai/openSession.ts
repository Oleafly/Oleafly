import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useInlineEditStore } from "@/store/inlineEdit";

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

export function openInlineEdit(view: EditorView): void {
  if (useInlineEditStore.getState().session) return; // one session at a time
  const { from, to, original } = resolveTargetRange(view.state);
  if (!original.trim()) return;
  useInlineEditStore.getState().open({ from, to, original });
}

export function toggleInlineEdit(view: EditorView): void {
  if (useInlineEditStore.getState().session) {
    // Reset lets the overlay's unmount effect abort any in-flight request.
    useInlineEditStore.getState().reset();
    return;
  }
  openInlineEdit(view);
}
