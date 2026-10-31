import { ChangeSet } from "@codemirror/state";
import { diff } from "@codemirror/merge";

export interface PersonalComment {
  id: string;
  body: string;
  quote: string;
  range: { from: number; to: number } | null;
  resolved: boolean;
}

export interface CommentFile {
  path: string;
  text: string;
  notes: PersonalComment[];
}

export interface PersonalComments {
  version: 1;
  files: CommentFile[];
}

// Keep the text the anchors were measured against. This also lets a restart
// reconcile an unsaved buffer or edits made by an external editor.
export function remapFile(file: CommentFile, text: string): CommentFile {
  if (file.text === text) return file;
  const changes = ChangeSet.of(
    diff(file.text, text).map((change) => ({
      from: change.fromA,
      to: change.toA,
      insert: text.slice(change.fromB, change.toB),
    })),
    file.text.length,
  );
  return {
    ...file,
    text,
    notes: file.notes.map((note) => {
      if (!note.range) return note;
      const from = changes.mapPos(note.range.from, 1);
      const to = Math.max(from, changes.mapPos(note.range.to, -1));
      return { ...note, range: from < to ? { from, to } : null };
    }),
  };
}

export function parseComments(value: unknown): PersonalComments {
  // A malformed file must surface an error, never be replaced with empty notes.
  const data = value as Partial<PersonalComments> | null;
  if (data?.version !== 1 || !Array.isArray(data.files)) throw new Error("Invalid personal comments");
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const file of data.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      typeof file.text !== "string" ||
      !Array.isArray(file.notes) ||
      paths.has(file.path)
    ) {
      throw new Error("Invalid personal comment file");
    }
    paths.add(file.path);
    for (const note of file.notes) {
      if (
        !note ||
        typeof note.id !== "string" ||
        ids.has(note.id) ||
        typeof note.body !== "string" ||
        typeof note.quote !== "string" ||
        typeof note.resolved !== "boolean" ||
        (note.range !== null &&
          (!note.range ||
            !Number.isInteger(note.range.from) ||
            !Number.isInteger(note.range.to) ||
            note.range.from < 0 ||
            note.range.to <= note.range.from ||
            note.range.to > file.text.length))
      ) {
        throw new Error("Invalid personal comment");
      }
      ids.add(note.id);
    }
  }
  return data as PersonalComments;
}

// Three-way merge for two app windows. Independent edits combine. If both
// changed the same note, keep both versions instead of discarding either.
export function mergeComments(
  base: PersonalComments,
  local: PersonalComments,
  remote: PersonalComments,
): PersonalComments {
  const paths = new Set([...local.files, ...remote.files].map((file) => file.path));
  const files: CommentFile[] = [];
  for (const path of paths) {
    const mine = local.files.find((file) => file.path === path);
    const theirs = remote.files.find((file) => file.path === path);
    const text = (mine ?? theirs)?.text ?? "";
    const notes = (data: PersonalComments) => {
      const file = data.files.find((entry) => entry.path === path);
      return new Map((file ? remapFile(file, text).notes : []).map((note) => [note.id, note]));
    };
    const before = notes(base);
    const left = notes(local);
    const right = notes(remote);
    const merged: PersonalComment[] = [];
    const same = (a: PersonalComment | undefined, b: PersonalComment | undefined) =>
      JSON.stringify(a) === JSON.stringify(b);
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      const b = before.get(id);
      const l = left.get(id);
      const r = right.get(id);
      const chosen = same(l, b) ? r : same(r, b) || same(l, r) ? l : (l ?? r);
      if (chosen) merged.push(chosen);
      if (l && r && !same(l, b) && !same(r, b) && !same(l, r)) merged.push({ ...r, id: crypto.randomUUID() });
    }
    if (merged.length) files.push({ path, text, notes: merged });
  }
  return { version: 1, files };
}
