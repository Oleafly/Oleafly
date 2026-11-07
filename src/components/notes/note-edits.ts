export interface NoteEdit {
  find: string;
  replace: string;
}

export interface AppliedNoteEdits {
  text: string;
  applied: number;
  skipped: number;
}

interface Placed {
  from: number;
  to: number;
  replace: string;
}

function placeOnce(source: string, find: string): number | null {
  const first = source.indexOf(find);
  if (first < 0 || source.indexOf(find, first + 1) >= 0) return null;
  return first;
}

export function applyNoteEdits(source: string, edits: readonly NoteEdit[]): AppliedNoteEdits {
  const placed: Placed[] = [];
  let skipped = 0;
  for (const edit of edits) {
    if (edit.find === "") {
      const gap = source === "" || source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
      placed.push({ from: source.length, to: source.length, replace: `${gap}${edit.replace}` });
      continue;
    }
    const at = placeOnce(source, edit.find);
    if (at === null) {
      skipped += 1;
      continue;
    }
    const candidate = { from: at, to: at + edit.find.length, replace: edit.replace };
    if (placed.some((other) => candidate.from < other.to && other.from < candidate.to)) {
      skipped += 1;
      continue;
    }
    placed.push(candidate);
  }
  let text = source;
  for (const edit of [...placed].sort((left, right) => right.from - left.from)) {
    text = `${text.slice(0, edit.from)}${edit.replace}${text.slice(edit.to)}`;
  }
  return { text, applied: placed.length, skipped };
}
