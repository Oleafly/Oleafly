import { EditorView } from "@codemirror/view";
import { SECTION_LINE_RE, typstOutlineChanged } from "@/components/editor/breadcrumbs-source";
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

const TYPED_EVENTS = ["input", "delete", "undo", "redo"] as const;

let selectionRevision = 0;
let selectionTyped = false;
const selectionMoved = createEmitter();

export function editorSelectionRevision(): number {
  return selectionRevision;
}

export function editorSelectionTyped(): boolean {
  return selectionTyped;
}

export const subscribeEditorSelection = selectionMoved.subscribe;

export function bumpEditorSelectionRevision(typed = false): void {
  selectionTyped = typed;
  selectionRevision++;
  selectionMoved.emit();
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
    const outlineChanged = typstOutlineChanged(update);
    if (!update.selectionSet && !update.docChanged && !outlineChanged) return;
    if (update.selectionSet || update.docChanged) {
      bumpEditorSelectionRevision(update.transactions.some((tr) => TYPED_EVENTS.some((event) => tr.isUserEvent(event))));
    }
    const head = update.state.selection.main.head;
    const line = update.state.doc.lineAt(head);
    const movedLine = line.number !== lastLine;
    lastLine = line.number;
    const editedHeading = update.docChanged && SECTION_LINE_RE.test(line.text);
    if (movedLine || editedHeading || outlineChanged) bumpEditorCursorRevision();
  });
}
