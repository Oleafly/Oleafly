import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "@/lib/log";
import { noteHeads } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { createNotesService, noteItems } from "./notes-service";
import { NotesWorkspace } from "./NotesWorkspace";

export function NotesHost() {
  const open = useHomeViewStore((state) => state.page === "notes");
  const enabled = useSettingsStore((state) => state.notes);

  useEffect(() => {
    if (open && !enabled) useHomeViewStore.getState().goTo("library");
  }, [enabled, open]);

  if (!open || !enabled) return null;
  return <NotesSurface />;
}

function NotesSurface() {
  const { t } = useTranslation(["notes"]);
  const projects = useFilesStore((state) => state.projects);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const [heads, setHeads] = useState<ReadonlyMap<string, string>>(new Map());
  const [initialNoteId] = useState(() => useNotesViewStore.getState().take());
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const refreshHeads = useCallback(() => {
    noteHeads().then(
      (list) => setHeads(new Map(list.map((head) => [head.id, head.head]))),
      (error) => void logError("read note heads", error),
    );
  }, []);

  useEffect(() => {
    void refreshProjects();
    refreshHeads();
  }, [refreshHeads, refreshProjects]);

  const service = useMemo(
    () =>
      createNotesService({
        projects: () => projectsRef.current,
        refreshProjects,
        refreshHeads,
        untitled: t(($) => $.notes.document.untitled),
        missing: t(($) => $.notes.document.loadFailed),
      }),
    [refreshHeads, refreshProjects, t],
  );

  const data = useMemo<NotesData>(
    () => ({
      ...service,
      notes: noteItems(projects, heads, t(($) => $.notes.library.ungrouped)),
      artifacts: [],
      experiments: [],
      agents: [],
      citations: [],
      papers: [],
    }),
    [heads, projects, service, t],
  );

  const createNote = service.createNote;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <NotesDataProvider value={data}>
        <NotesWorkspace
          initialNoteId={initialNoteId}
          onExit={() => useHomeViewStore.getState().goTo("library")}
          onNewNote={() =>
            createNote
              ? createNote().catch((error: unknown) => {
                  void logError("create note", error);
                  return null;
                })
              : Promise.resolve(null)
          }
        />
      </NotesDataProvider>
    </div>
  );
}
