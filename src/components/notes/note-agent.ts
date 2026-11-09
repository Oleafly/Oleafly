import type { NoteEdit } from "./note-edits";

const FIND = "<<<<<<< FIND";
const SPLIT = "=======";
const REPLACE = ">>>>>>> REPLACE";
const NO_CHANGES = "NO CHANGES";

export function parseNoteEdits(text: string): { edits: NoteEdit[]; noChanges: boolean } {
  const edits: NoteEdit[] = [];
  let state: "outside" | "find" | "replace" = "outside";
  let find: string[] = [];
  let replace: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const marker = line.trim();
    if (state === "outside") {
      if (marker === FIND) {
        state = "find";
        find = [];
        replace = [];
      }
      continue;
    }
    if (state === "find") {
      if (marker === SPLIT) state = "replace";
      else find.push(line);
      continue;
    }
    if (marker === REPLACE) {
      const edit = { find: find.join("\n"), replace: replace.join("\n") };
      if (edit.find !== edit.replace) edits.push(edit);
      state = "outside";
    } else {
      replace.push(line);
    }
  }
  return { edits, noChanges: edits.length === 0 && text.includes(NO_CHANGES) };
}
