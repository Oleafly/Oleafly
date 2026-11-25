import type { ProjectInfo } from "@oleafly/backend-port";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sourceLanguageForPath } from "@/lib/document-engine";
import { linkBase } from "@/lib/file-links";
import { logError } from "@/lib/log";
import { foldPath, NOTE_FILE_KIND } from "@/lib/project-notes";
import { noteLinks, readFileContent, readProjectBytes, releaseNoteCaches, setNoteRelatedProject } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNotesViewStore } from "@/store/notes-view";
import { useSettingsStore } from "@/store/settings";

import { NotesDataProvider, type NotesData } from "./notes-data";
import { createNoteItems, createNotesService, refreshNoteFacts, relatedProjectChoices, useVaultFacts } from "./notes-service";
import type { PaperFormat, PaperPlace } from "./note-to-paper";
import { NotesWorkspace, type ProjectSeed } from "./NotesWorkspace";
import { shareNote } from "./NoteShareButton";
import { createStarterNote } from "./starter-note";
import type { ArtifactItem, ExperimentItem, PaperTarget } from "./types";
import { NoteLinkIndexProvider } from "./use-note-links";

const NO_ARTIFACTS: readonly ArtifactItem[] = [];
const NO_EXPERIMENTS: readonly ExperimentItem[] = [];
const NO_PAPERS: readonly PaperTarget[] = [];

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
  const { pandocConvert } = await import("@/features/pandoc-text");
  return ((await pandocConvert({ source: "markdown-fragment", target: format, text })).text ?? "").trim();
}

async function openPaperPlace(paperId: string, format: PaperFormat, activePath: string, text: string): Promise<PaperPlace> {
  const { tree, mainDoc } = useFilesStore.getState();
  const [{ figureDirectory }, { preambleTheorems, hasCitations }, { projectCitations }] = await Promise.all([
    import("@/components/editor/figure-import"),
    import("./note-to-paper"),
    import("./note-citations"),
  ]);
  const taken = new Set(tree.map((entry) => foldPath(entry.path)));
  const preamble = format === "latex" ? await readFileContent(paperId, mainDoc).catch(() => "") : "";
  const cited = format === "typst" && hasCitations(text) ? await projectCitations(paperId).catch(() => []) : [];
  const keys = new Set(cited.map((entry) => entry.key));
  return {
    format,
    folder: figureDirectory(tree, mainDoc),
    from: linkBase(activePath, mainDoc),
    taken: (path) => taken.has(foldPath(path)),
    theorems: preambleTheorems(preamble),
    citations: format === "latex" ? { kind: "command" } : { kind: "keys", known: (key) => format === "markdown" || keys.has(key) },
  };
}

export async function sendTextToPaper(paperId: string, text: string, noteId: string, shared = false): Promise<boolean> {
  const files = useFilesStore.getState();
  const format = paperFormat(files.activePath);
  if (files.projectId !== paperId || !format || !files.activePath) return false;
  const [{ notePaperText }, { saveProjectFiles }] = await Promise.all([
    import("./note-to-paper"),
    import("@/components/editor/figure-import"),
  ]);
  const place = { ...(await openPaperPlace(paperId, format, files.activePath, text)), shared };
  const read = async (path: string) => new Uint8Array(await readProjectBytes(noteId, path));
  const prepared = await notePaperText(text, read, place);
  await saveProjectFiles(paperId, prepared.files);
  if (format === "latex" && files.mainDoc && prepared.packages.length > 0) {
    const { insertUsepackages } = await import("@/components/packages/latex-document");
    await insertUsepackages(files.mainDoc, prepared.packages);
  }
  const converted = await convertForPaper(prepared.text, format);
  const { insertAtCursor } = await import("@/components/editor/cm/controller");
  useHomeViewStore.getState().goTo("library");
  insertAtCursor(converted);
  return true;
}

function noteTextChanged(id: string): void {
  void refreshNoteFacts([id]).catch((error: unknown) => logError("read a live note's facts", error));
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
    return project && project.kind !== NOTE_FILE_KIND ? [{ id: project.id, label: project.name }] : NO_PAPERS;
  }, [format, openId, projects]);
}

function NotesSurface() {
  const { t } = useTranslation(["notes"]);
  const projects = useFilesStore((state) => state.projects);
  const projectsLoaded = useFilesStore((state) => state.projectsLoaded);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const [initial] = useState(() => {
    const fragment = useNotesViewStore.getState().requestedFragment;
    return { noteId: useNotesViewStore.getState().take(), fragment };
  });
  const [noteItems] = useState(createNoteItems);
  const requestedNoteId = useNotesViewStore((state) => state.requestedNoteId);
  const requestedFragment = useNotesViewStore((state) => state.requestedFragment);
  const takeRequest = useCallback(() => {
    useNotesViewStore.getState().take();
  }, []);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  useEffect(() => {
    void refreshProjects();
    return () => void releaseNoteCaches().catch((error: unknown) => logError("release the note caches", error));
  }, [refreshProjects]);

  const ungrouped = t(($) => $.notes.library.ungrouped);
  const { vault } = useVaultFacts(projects);
  const notes = useMemo(() => noteItems(projects, vault?.facts, ungrouped), [noteItems, projects, ungrouped, vault?.facts]);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  const papers = useOpenPapers(projects);

  const service = useMemo(
    () =>
      createNotesService({
        projects: () => projectsRef.current,
        refreshProjects,
        untitled: t(($) => $.notes.document.untitled),
        missing: t(($) => $.notes.document.loadFailed),
      }),
    [refreshProjects, t],
  );

  useEffect(() => {
    if (!projectsLoaded) return;
    createStarterNote({ createNoteFrom: service.createNoteFrom, t, notes: () => notesRef.current }).catch((error: unknown) =>
      logError("create the starter note", error),
    );
  }, [projectsLoaded, service, t]);

  const data = useMemo<NotesData>(
    () => ({
      ...service,
      artifacts: NO_ARTIFACTS,
      experiments: NO_EXPERIMENTS,
      notes,
      revision: vault?.revision,
      taskRevision: vault?.taskRevision,
      changedNotes: vault?.changed,
      noteTextChanged,
      projects: choices,
      openSettings: openNotesSettings,
      shareNote,
      openProject: openLinkedProject,
      papers,
      noteLinks,
    }),
    [choices, notes, papers, service, vault?.changed, vault?.revision, vault?.taskRevision],
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
    ({ paperId, text, noteId }: { paperId: string; text: string; noteId: string }) => {
      const shared = notesRef.current.some((note) => note.id === noteId && note.shared === true);
      sendTextToPaper(paperId, text, noteId, shared).then(
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
            initialNoteId={initial.noteId}
            initialFragment={initial.fragment}
            requestedNoteId={requestedNoteId}
            requestedFragment={requestedFragment}
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
