import type { ProjectInfo } from "@oleafly/backend-port";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { acpCatalog } from "@/lib/acp";
import { sourceLanguageForPath } from "@/lib/document-engine";
import { logError } from "@/lib/log";
import type { ResearchTask } from "@/lib/research-tasks";
import { noteHeads, noteLinks, setNoteRelatedProject } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useResearchTasksEnabled } from "@/store/research-tasks-flag";
import { useSettingsStore } from "@/store/settings";
import { artifactItems, experimentItems, latestRunContext } from "./note-artifacts";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { NOTE_KIND } from "./note-file";
import { createNoteItems, createNotesService, noteHeadOf, relatedProjectChoices } from "./notes-service";
import { NotesWorkspace, type ProjectSeed } from "./NotesWorkspace";
import { shareNote } from "./NoteShareButton";
import type { ArtifactItem, ExperimentItem, PaperTarget } from "./types";
import { NoteLinkIndexProvider } from "./use-note-links";
import { useResearchTasks } from "./use-research-tasks";

const LIVE_HEAD_DELAY_MS = 1_000;

type PaperFormat = "latex" | "typst" | "markdown";

const NO_NAMES: ReadonlyMap<string, string> = new Map();
const NO_IDS: readonly string[] = [];
const NO_ARTIFACTS: readonly ArtifactItem[] = [];
const NO_EXPERIMENTS: readonly ExperimentItem[] = [];
const NO_PAPERS: readonly PaperTarget[] = [];

function useChangeCount(value: unknown): number {
  const seen = useRef({ value, count: 0 });
  if (seen.current.value !== value) seen.current = { value, count: seen.current.count + 1 };
  return seen.current.count;
}

function noteSignature(projects: readonly ProjectInfo[]): string {
  return projects
    .filter((project) => project.kind === NOTE_KIND)
    .map((project) => `${project.id}\u0000${project.name}\u0000${project.updated_at}\u0000${project.related_project ?? ""}\u0000${project.shared ? 1 : 0}`)
    .join("\u0001");
}

function openNotesSettings(): void {
  useSettingsStore.getState().openSettingsAt("appearance", "notes");
}

function openLinkedProject(projectId: string): void {
  useHomeViewStore.getState().goTo("library");
  void useFilesStore.getState().openProject(projectId);
}

export function paperFormat(path: string | null): PaperFormat | null {
  const language = sourceLanguageForPath(path);
  return language === "latex" || language === "typst" || language === "markdown" ? language : null;
}

async function convertForPaper(text: string, format: PaperFormat): Promise<string> {
  if (format === "markdown") return text;
  const { pandocConvert } = await import("@/features/tools-ai/pandoc-text");
  return (await pandocConvert({ source: "markdown", target: format, text })).text ?? "";
}

export async function sendTextToPaper(paperId: string, text: string): Promise<boolean> {
  const files = useFilesStore.getState();
  const format = paperFormat(files.activePath);
  if (files.projectId !== paperId || !format) return false;
  const converted = await convertForPaper(text, format);
  const { insertAtCursor } = await import("@/components/editor/cm/controller");
  useHomeViewStore.getState().goTo("library");
  insertAtCursor(converted);
  return true;
}

let stopProjectLink: (() => void) | null = null;

function linkNoteToNextProject(noteId: string, onFailed: (error: unknown) => void): void {
  stopProjectLink?.();
  const known = new Set(useFilesStore.getState().projects.map((project) => project.id));
  let stopFiles = () => {};
  let stopSettings = () => {};
  const stop = () => {
    stopFiles();
    stopSettings();
    if (stopProjectLink === stop) stopProjectLink = null;
  };
  stopFiles = useFilesStore.subscribe((state, previous) => {
    const projectId = state.projectId;
    if (!projectId || projectId === previous.projectId || known.has(projectId)) return;
    stop();
    useHomeViewStore.getState().goTo("library");
    setNoteRelatedProject(noteId, projectId).then(() => useFilesStore.getState().refreshProjects(), onFailed);
  });
  stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (previous.newProjectOpen && !state.newProjectOpen) stop();
  });
  stopProjectLink = stop;
  useSettingsStore.getState().setNewProjectOpen(true);
}

export function NotesHost() {
  const open = useHomeViewStore((state) => state.page === "notes");
  const enabled = useSettingsStore((state) => state.notes);

  useEffect(() => {
    if (open && !enabled) useHomeViewStore.getState().goTo("library");
  }, [enabled, open]);

  if (!open || !enabled) return null;
  return <NotesSurface />;
}

function useOpenPapers(projects: readonly ProjectInfo[]): readonly PaperTarget[] {
  const openId = useFilesStore((state) => state.projectId);
  const format = useFilesStore((state) => paperFormat(state.activePath));
  return useMemo(() => {
    if (!openId || !format) return NO_PAPERS;
    const project = projects.find((candidate) => candidate.id === openId);
    return project && project.kind !== NOTE_KIND ? [{ id: project.id, label: project.name }] : NO_PAPERS;
  }, [format, openId, projects]);
}

function NotesSurface() {
  const { t } = useTranslation(["notes"]);
  const projects = useFilesStore((state) => state.projects);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const research = useResearchTasksEnabled();
  const [heads, setHeads] = useState<ReadonlyMap<string, string>>(new Map());
  const [initialNoteId] = useState(() => useNotesViewStore.getState().take());
  const [noteItems] = useState(createNoteItems);
  const requestedNoteId = useNotesViewStore((state) => state.requestedNoteId);
  const takeRequest = useCallback(() => void useNotesViewStore.getState().take(), []);
  const [agentNames, setAgentNames] = useState<ReadonlyMap<string, string>>(NO_NAMES);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const [headLoads, setHeadLoads] = useState(0);
  const [writes, setWrites] = useState(0);
  const headsLoaded = useRef(false);
  const knowledge = useRef(new Map<string, string>());
  const live = useRef<{ timer: number | null; pending: Map<string, string> }>({ timer: null, pending: new Map() });

  const refreshHeads = useCallback(() => {
    noteHeads().then(
      (list) => {
        setHeads(new Map(list.map((head) => [head.id, head.head])));
        if (headsLoaded.current) setHeadLoads((count) => count + 1);
        headsLoaded.current = true;
      },
      (error) => void logError("read note heads", error),
    );
  }, []);

  const applyHeads = useCallback((updates: ReadonlyMap<string, string>) => {
    setHeads((current) => {
      let next = current;
      for (const [id, head] of updates) {
        if (next.get(id) === head) continue;
        if (next === current) next = new Map(current);
        (next as Map<string, string>).set(id, head);
      }
      return next;
    });
  }, []);

  const setHead = useCallback(
    (id: string, head: string, changed: boolean, key: string) => {
      live.current.pending.delete(id);
      applyHeads(new Map([[id, head]]));
      const known = knowledge.current.get(id);
      knowledge.current.set(id, key);
      if (changed && known !== key) setWrites((count) => count + 1);
    },
    [applyHeads],
  );

  const noteTextChanged = useCallback(
    (id: string, text: string) => {
      const state = live.current;
      const head = noteHeadOf(text);
      if (state.timer !== null) {
        state.pending.set(id, head);
        return;
      }
      applyHeads(new Map([[id, head]]));
      const flush = () => {
        if (state.pending.size === 0) {
          state.timer = null;
          return;
        }
        const updates = state.pending;
        state.pending = new Map();
        applyHeads(updates);
        state.timer = window.setTimeout(flush, LIVE_HEAD_DELAY_MS);
      };
      state.timer = window.setTimeout(flush, LIVE_HEAD_DELAY_MS);
    },
    [applyHeads],
  );

  useEffect(
    () => () => {
      if (live.current.timer !== null) window.clearTimeout(live.current.timer);
    },
    [],
  );

  useEffect(() => {
    void refreshProjects();
    refreshHeads();
  }, [refreshHeads, refreshProjects]);

  const ungrouped = t(($) => $.notes.library.ungrouped);
  const notes = useMemo(() => noteItems(projects, heads, ungrouped), [heads, noteItems, projects, ungrouped]);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const signature = useMemo(() => noteSignature(projects), [projects]);
  const revision = useChangeCount(signature) + headLoads + writes;
  const relatedIds = useMemo(
    () => (research ? notes.flatMap((note) => (note.relatedProjectId ? [note.relatedProjectId] : [])) : NO_IDS),
    [notes, research],
  );
  const tasks = useResearchTasks(relatedIds);
  const namesAgents = useMemo(() => [...tasks.values()].some((list) => list.some((task) => task.agentId)), [tasks]);

  useEffect(() => {
    if (!namesAgents) return;
    let alive = true;
    acpCatalog().then(
      (catalog) => {
        if (alive) setAgentNames(new Map(catalog.map((agent) => [agent.definition.id, agent.definition.name])));
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [namesAgents]);

  const artifacts = useMemo(() => {
    if (!research) return NO_ARTIFACTS;
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const agentName = (task: ResearchTask) => agentNames.get(task.agentId) ?? (task.modelId || task.agentId || undefined);
    return [...tasks]
      .flatMap(([projectId, list]) => artifactItems(list, names.get(projectId) ?? projectId, agentName))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [agentNames, projects, research, tasks]);
  const experiments = useMemo(
    () => (research ? experimentItems(tasks, artifacts, notes) : NO_EXPERIMENTS),
    [artifacts, notes, research, tasks],
  );
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  const papers = useOpenPapers(projects);
  const latestRun = useCallback(
    (noteId: string) => {
      const related = notesRef.current.find((note) => note.id === noteId)?.relatedProjectId;
      return related ? latestRunContext(tasks.get(related) ?? []) : null;
    },
    [tasks],
  );

  const service = useMemo(
    () =>
      createNotesService({
        projects: () => projectsRef.current,
        refreshProjects,
        refreshHeads,
        setHead,
        untitled: t(($) => $.notes.document.untitled),
        missing: t(($) => $.notes.document.loadFailed),
      }),
    [refreshHeads, refreshProjects, setHead, t],
  );

  const data = useMemo<NotesData>(
    () => ({
      ...service,
      notes,
      revision,
      noteTextChanged,
      artifacts,
      experiments,
      researchTasks: research,
      projects: choices,
      latestRun,
      openSettings: openNotesSettings,
      shareNote,
      openProject: openLinkedProject,
      papers,
      noteLinks,
    }),
    [artifacts, choices, experiments, latestRun, noteTextChanged, notes, papers, research, revision, service],
  );

  const createNote = service.createNote;
  const onNewNote = useCallback(
    () =>
      createNote
        ? createNote().catch((error: unknown) => {
            notifyError("create note", error, t(($) => $.notes.failures.createNote));
            return null;
          })
        : Promise.resolve(null),
    [createNote, t],
  );
  const onCreateProject = useCallback(
    (seed: ProjectSeed) =>
      linkNoteToNextProject(seed.noteId, (error) =>
        notifyError("link the note to its new project", error, t(($) => $.notes.failures.linkProject)),
      ),
    [t],
  );
  const onSendToPaper = useCallback(
    ({ paperId, text }: { paperId: string; text: string }) => {
      sendTextToPaper(paperId, text).then(
        (sent) => {
          if (!sent) toast.error(t(($) => $.notes.failures.paperNotOpen));
        },
        (error: unknown) => notifyError("send a note to a paper", error, t(($) => $.notes.failures.sendToPaper)),
      );
    },
    [t],
  );
  const onExit = useCallback(() => useHomeViewStore.getState().goTo("library"), []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <NotesDataProvider value={data}>
        <NoteLinkIndexProvider>
          <NotesWorkspace
            initialNoteId={initialNoteId}
            requestedNoteId={requestedNoteId}
            onRequestHandled={takeRequest}
            onExit={onExit}
            onNewNote={onNewNote}
            onCreateProject={onCreateProject}
            onSendToPaper={onSendToPaper}
          />
        </NoteLinkIndexProvider>
      </NotesDataProvider>
    </div>
  );
}
