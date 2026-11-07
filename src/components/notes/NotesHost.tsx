import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { acpCatalog, type AcpAgentStatus } from "@/lib/acp";
import { logError } from "@/lib/log";
import { getConfig, noteHeads, type AppConfig } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";
import type { ResearchTask } from "@/lib/research-tasks";
import { noteAgentGroups } from "./note-agent";
import { artifactItems, experimentItems, latestRunContext } from "./note-artifacts";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { createNotesService, noteItems, relatedProjectChoices } from "./notes-service";
import { NotesWorkspace } from "./NotesWorkspace";
import { useResearchTasks } from "./use-research-tasks";

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
  const [agentSource, setAgentSource] = useState<{ cfg: AppConfig; catalog: AcpAgentStatus[] } | null>(null);
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

  useEffect(() => {
    let live = true;
    Promise.all([getConfig(), acpCatalog().catch(() => [])]).then(
      ([cfg, catalog]) => {
        if (live) setAgentSource({ cfg, catalog });
      },
      (error: unknown) => void logError("load note agents", error),
    );
    return () => {
      live = false;
    };
  }, []);

  const agents = useMemo(
    () => (agentSource ? noteAgentGroups(agentSource.cfg, agentSource.catalog) : []),
    [agentSource],
  );
  const preferredAgent = useMemo(
    () => (agentSource ? { providerId: agentSource.cfg.ai_provider, modelId: agentSource.cfg.ai_model } : null),
    [agentSource],
  );

  const notes = useMemo(() => noteItems(projects, heads, t(($) => $.notes.library.ungrouped)), [heads, projects, t]);
  const tasks = useResearchTasks(notes.flatMap((note) => (note.relatedProjectId ? [note.relatedProjectId] : [])));
  const artifacts = useMemo(() => {
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const agentNames = new Map((agentSource?.catalog ?? []).map((agent) => [agent.definition.id, agent.definition.name]));
    const agentName = (task: ResearchTask) => agentNames.get(task.agentId) ?? (task.modelId || task.agentId || undefined);
    return [...tasks].flatMap(([projectId, list]) => artifactItems(list, names.get(projectId) ?? projectId, agentName))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [agentSource, projects, tasks]);
  const experiments = useMemo(() => experimentItems(tasks, artifacts, notes), [artifacts, notes, tasks]);
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  const latestRun = useCallback(
    (noteId: string) => {
      const related = notes.find((note) => note.id === noteId)?.relatedProjectId;
      return related ? latestRunContext(tasks.get(related) ?? []) : null;
    },
    [notes, tasks],
  );

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
      notes,
      artifacts,
      experiments,
      projects: choices,
      latestRun,
      agents,
      preferredAgent,
      openAgentSettings: () => {
        const settings = useSettingsStore.getState();
        settings.setSettingsInitialSection("ai");
        settings.setSettingsOpen(true);
      },
      openSettings: () => useSettingsStore.getState().setSettingsOpen(true),
      citations: [],
      papers: [],
    }),
    [agents, artifacts, choices, experiments, latestRun, notes, preferredAgent, service],
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
