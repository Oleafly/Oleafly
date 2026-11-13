import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "@/lib/log";
import { noteLinks } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import type { NotesData } from "./notes-data";
import { createNoteItems, createNotesService, refreshNoteFacts, relatedProjectChoices, useVaultFacts } from "./notes-service";

const NONE: readonly never[] = [];

function noteTextChanged(id: string): void {
  void refreshNoteFacts([id]).catch((error: unknown) => logError("read a live note's facts", error));
}

function openProject(projectId: string): void {
  useFilesStore
    .getState()
    .openProject(projectId)
    .catch((error: unknown) => logError("open a project from a note tab", error));
}

function useNotesService() {
  const { t } = useTranslation(["notes"]);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const untitled = t(($) => $.notes.document.untitled);
  const missing = t(($) => $.notes.document.loadFailed);
  return useMemo(
    () => createNotesService({ projects: () => useFilesStore.getState().projects, refreshProjects, untitled, missing }),
    [missing, refreshProjects, untitled],
  );
}

export function useNoteActionsData(): NotesData {
  const projects = useFilesStore((state) => state.projects);
  const service = useNotesService();
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  return useMemo(
    () => ({ ...service, notes: NONE, artifacts: NONE, experiments: NONE, papers: NONE, projects: choices }),
    [choices, service],
  );
}

export interface LibraryNotesData {
  data: NotesData;
  headsLoaded: boolean;
}

export function useLibraryNotesData(): LibraryNotesData {
  const { t } = useTranslation(["notes"]);
  const projects = useFilesStore((state) => state.projects);
  const [noteItems] = useState(createNoteItems);
  const { vault, failed } = useVaultFacts(projects);
  const ungrouped = t(($) => $.notes.library.ungrouped);
  const notes = useMemo(() => noteItems(projects, vault?.facts, ungrouped), [noteItems, projects, ungrouped, vault?.facts]);
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  const service = useNotesService();

  const data = useMemo<NotesData>(
    () => ({
      ...service,
      notes,
      revision: vault?.revision,
      taskRevision: vault?.taskRevision,
      changedNotes: vault?.changed,
      noteTextChanged,
      artifacts: NONE,
      experiments: NONE,
      papers: NONE,
      projects: choices,
      noteLinks,
      openProject,
    }),
    [choices, notes, service, vault?.changed, vault?.revision, vault?.taskRevision],
  );

  return { data, headsLoaded: vault !== undefined || failed };
}
