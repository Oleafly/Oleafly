import { i18n, loadNamespace } from "@/i18n";
import { type NoteFacts, noteFacts } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { createNoteItems, createNotesService, type NotesService } from "./notes-service";
import type { NoteItem } from "./types";

export interface VaultSnapshot {
  notes: NoteItem[];
  facts: readonly NoteFacts[];
}

export async function appNotesService(): Promise<NotesService> {
  await loadNamespace("notes");
  return createNotesService({
    projects: () => useFilesStore.getState().projects,
    refreshProjects: () => useFilesStore.getState().refreshProjects(),
    untitled: i18n.t(($) => $.notes.document.untitled),
    missing: i18n.t(($) => $.notes.document.loadFailed),
  });
}

export async function vaultSnapshot(): Promise<VaultSnapshot> {
  const [facts] = await Promise.all([noteFacts().then((found) => found ?? []), useFilesStore.getState().refreshProjects()]);
  return { notes: createNoteItems()(useFilesStore.getState().projects, facts, ""), facts };
}

export function linkIdsOf(facts: readonly NoteFacts[]): Map<string, string> {
  return new Map(facts.flatMap((fact) => (fact.noteId ? [[fact.id, fact.noteId] as const] : [])));
}
