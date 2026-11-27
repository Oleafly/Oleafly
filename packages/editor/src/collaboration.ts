import { Annotation, type ChangeSet, EditorState, type Transaction } from "@codemirror/state";
import type { LocalOrigin, Utf16Edit } from "./document-session";

export const remoteChange = Annotation.define<boolean>();

export const documentLoad = Annotation.define<boolean>();

// While a document session is bound, a carriage return in the shared text has
// to count as one character in the editor too, or every offset after it is
// off by one between the editor and everyone else. CodeMirror's default treats
// CRLF as a single line break, so session files split lines on LF only.
export const sessionLineBreaks = EditorState.lineSeparator.of("\n");

const ORIGINS: readonly (readonly [string, LocalOrigin])[] = [
  ["undo", "undo"],
  ["redo", "redo"],
  ["delete.cut", "cut"],
  ["input.paste", "paste"],
];

export function localOrigin(transaction: Transaction): LocalOrigin | undefined {
  return ORIGINS.find(([event]) => transaction.isUserEvent(event))?.[1];
}

export function changesToUtf16Edits(changes: ChangeSet): Utf16Edit[] {
  const edits: Utf16Edit[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return edits;
}
