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

function sessionInFlight(): boolean {
  const session = useInlineEditStore.getState().session;
  return session !== null && session.phase !== "withdrawn";
}

export function openInlineEdit(view: EditorView): void {
  if (view.state.readOnly) return;
  if (sessionInFlight()) return;
  const { from, to, original } = resolveTargetRange(view.state);
  if (!original.trim()) return;
  useInlineEditStore.getState().open({ from, to, original });
}

export function openInlineEditWithInstruction(
  view: EditorView,
  instruction: string,
): boolean {
  if (view.state.readOnly) return false;
  const store = useInlineEditStore.getState();
  if (sessionInFlight()) return false;
  const { from, to, original } = resolveTargetRange(view.state);
  if (!original.trim()) return false;
  store.open({ from, to, original, instruction, autoRun: true });
  return true;
}

export function toggleInlineEdit(view: EditorView): void {
  if (useInlineEditStore.getState().session) {
    useInlineEditStore.getState().reset();
    return;
  }
  openInlineEdit(view);
}
