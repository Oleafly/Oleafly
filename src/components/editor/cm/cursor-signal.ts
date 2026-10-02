import { EditorView } from "@codemirror/view";
import { SECTION_LINE_RE } from "@/components/editor/breadcrumbs-source";
import { createEmitter } from "@/lib/emitter";

let revision = 0;
let lastLine = -1;
let lastDocument = "";
const cursorMoved = createEmitter();

export function editorCursorRevision(): number {
  return revision;
}

export const subscribeEditorCursor = cursorMoved.subscribe;

export function bumpEditorCursorRevision(): void {
  revision++;
  cursorMoved.emit();
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
