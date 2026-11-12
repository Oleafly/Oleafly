import { i18n } from "@/i18n";
import type { NotesPeriodic } from "@/lib/notes-periodic";
import { openNoteEditor } from "@/lib/open-note-editors";
import { useSettingsStore } from "@/store/settings";
import { appNotesService, vaultSnapshot } from "./app-notes";
import { dailyNoteId } from "./daily-note";
import { applyNoteEdits } from "./note-edits";
import type { NotesService } from "./notes-service";
import { captureDraft, type CaptureRequest } from "./quick-capture";
import { NoteConflictError, type NoteItem, type NoteSource } from "./types";

const WRITE_ATTEMPTS = 3;

export interface CaptureDeps {
  service: Pick<NotesService, "createNoteFrom" | "loadNote" | "saveNote">;
  notes: () => Promise<readonly NoteItem[]>;
  flush: (noteId: string) => Promise<unknown>;
  now: () => Date;
  locale: string;
  periodic: NotesPeriodic;
}

export function appendToNote(source: string, text: string): string {
  const added = text.replaceAll(/\r\n?/gu, "\n").trim();
  if (!added) return source;
  return applyNoteEdits(source.trimEnd(), [{ find: "", replace: `${added}\n` }]).text;
}

async function saveAppended(
  service: CaptureDeps["service"],
  noteId: string,
  text: string,
  note: NoteSource,
  attempt: number,
): Promise<void> {
  try {
    await service.saveNote(noteId, appendToNote(note.text, text), note.version);
  } catch (error) {
    if (!(error instanceof NoteConflictError) || attempt >= WRITE_ATTEMPTS) throw error;
    await saveAppended(service, noteId, text, error.disk, attempt + 1);
  }
}

async function appendWithRetry(service: CaptureDeps["service"], noteId: string, text: string): Promise<void> {
  await saveAppended(service, noteId, text, await service.loadNote(noteId), 1);
}

export async function saveCapture(request: CaptureRequest, deps: CaptureDeps): Promise<string> {
  const create = deps.service.createNoteFrom;
  if (!create) throw new Error("Notes can't create notes here.");
  if (request.target === "new") return create(captureDraft(request.text));
  const data = { notes: [...(await deps.notes())], createNoteFrom: create, loadNote: deps.service.loadNote };
  const id = await dailyNoteId(data, deps.now(), deps.locale, deps.periodic);
  if (!id) throw new Error(i18n.t(($) => $.notes.vault.daily.failed));
  await deps.flush(id);
  await appendWithRetry(deps.service, id, request.text);
  return id;
}

export async function appCaptureDeps(): Promise<CaptureDeps> {
  return {
    service: await appNotesService(),
    notes: async () => (await vaultSnapshot()).notes,
    flush: async (noteId) => openNoteEditor(noteId)?.flush(),
    now: () => new Date(),
    locale: i18n.language,
    periodic: useSettingsStore.getState().notesPeriodic,
  };
}
