import { Annotation, type ChangeSet, EditorState } from "@codemirror/state";
import type { Utf16Edit } from "./document-session";

export const remoteChange = Annotation.define<boolean>();

// While a document session is bound, a carriage return in the shared text has
// to count as one character in the editor too, or every offset after it is
// off by one between the editor and everyone else. CodeMirror's default treats
// CRLF as a single line break, so session files split lines on LF only.
export const sessionLineBreaks = EditorState.lineSeparator.of("\n");

export function changesToUtf16Edits(changes: ChangeSet): Utf16Edit[] {
  const edits: Utf16Edit[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return edits;
}
