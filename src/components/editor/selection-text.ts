import { getEditorView } from "@/components/editor/cm/controller";

export function activeSelectionText(): string | null {
  const view = getEditorView();
  if (!view) return null;
  const sel = view.state.selection.main;
  if (sel.empty) return null;
  return view.state.sliceDoc(sel.from, sel.to);
}
