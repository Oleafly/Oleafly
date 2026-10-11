import { Annotation, type ChangeSet } from "@codemirror/state";
import type { Utf16Edit } from "./document-session";

export const remoteChange = Annotation.define<boolean>();

export function changesToUtf16Edits(changes: ChangeSet): Utf16Edit[] {
  const edits: Utf16Edit[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  return edits;
}
