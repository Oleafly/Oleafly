import type { CheckpointPublicationOutcome } from "@oleafly/backend-port";
import { checkpointReadText, checkpointSave } from "@/lib/checkpoints";
import { logError } from "@/lib/log";
import { openNoteEditor } from "@/lib/open-note-editors";
import { NOTE_FILE_KIND } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import type { NotesData } from "./notes-data";

export function noteVersionFile(noteId: string): string | null {
  const project = useFilesStore.getState().projects.find((candidate) => candidate.id === noteId);
  return project?.kind === NOTE_FILE_KIND ? project.main_doc : null;
}

function versionKept(outcome: CheckpointPublicationOutcome): boolean {
  if (outcome.status === "unchanged") return false;
  if (outcome.status === "published" || outcome.status === "published_durability_uncertain") return true;
  throw new Error(outcome.status === "skipped" ? outcome.message : `the version was not saved (${outcome.status})`);
}

export async function saveNoteVersion(noteId: string): Promise<boolean> {
  await openNoteEditor(noteId)?.flush();
  return versionKept(await checkpointSave(noteId));
}

export function saveVersionBeforeAccept(noteId: string, text: string): void {
  if (noteVersionFile(noteId) === null) return;
  checkpointSave(noteId, text).then(versionKept).catch((error: unknown) => logError("save a version before accepting all", error));
}

export function readNoteVersion(noteId: string, snapshotRoot: string): Promise<string> {
  const path = noteVersionFile(noteId);
  if (path === null) return Promise.reject(new Error("the note has no version history"));
  return checkpointReadText(noteId, snapshotRoot, path);
}

export async function restoreNoteVersion(
  data: Pick<NotesData, "loadNote" | "saveNote">,
  noteId: string,
  snapshotRoot: string,
): Promise<void> {
  const text = await readNoteVersion(noteId, snapshotRoot);
  await saveNoteVersion(noteId);
  const current = await data.loadNote(noteId);
  await data.saveNote(noteId, text, current.version);
}
