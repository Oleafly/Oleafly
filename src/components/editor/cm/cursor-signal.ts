import { EditorView } from "@codemirror/view";
import { SECTION_LINE_RE } from "@/components/editor/breadcrumbs-source";

let revision = 0;
let lastLine = -1;
let lastDocument = "";
const listeners = new Set<() => void>();

export function editorCursorRevision(): number {
  return revision;
}

export function subscribeEditorCursor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bumpEditorCursorRevision(): void {
  revision++;
  for (const listener of listeners) listener();
}

export function noteEditorDocument(path: string | null, version: number): void {
  const key = `${path ?? ""}\u0000${version}`;
  if (key === lastDocument) return;
  lastDocument = key;
  lastLine = -1;
  bumpEditorCursorRevision();
}

export function cursorSignalExtension() {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged) return;
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    const movedLine = line.number !== lastLine;
    lastLine = line.number;
    const editedHeading = update.docChanged && SECTION_LINE_RE.test(line.text);
    if (movedLine || editedHeading) bumpEditorCursorRevision();
  });
}
