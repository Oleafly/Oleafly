import type { NoteEdit } from "./note-edits";

const FIND = "<<<<<<< FIND";
const SPLIT = "=======";
const REPLACE = ">>>>>>> REPLACE";
const NO_CHANGES = "NO CHANGES";

interface EditDraft {
  find: string[];
  replace: string[];
  replacing: boolean;
}

function readEditLine(draft: EditDraft | null, line: string, edits: NoteEdit[]): EditDraft | null {
  const marker = line.trim();
  if (!draft) return marker === FIND ? { find: [], replace: [], replacing: false } : null;
  if (!draft.replacing) {
    if (marker === SPLIT) draft.replacing = true;
    else draft.find.push(line);
    return draft;
  }
  if (marker !== REPLACE) {
    draft.replace.push(line);
    return draft;
  }
  const edit = { find: draft.find.join("\n"), replace: draft.replace.join("\n") };
  if (edit.find !== edit.replace) edits.push(edit);
  return null;
}

export function parseNoteEdits(text: string): { edits: NoteEdit[]; noChanges: boolean } {
  const edits: NoteEdit[] = [];
  let draft: EditDraft | null = null;
  for (const line of text.split(/\r?\n/u)) draft = readEditLine(draft, line, edits);
  return { edits, noChanges: edits.length === 0 && text.includes(NO_CHANGES) };
}
