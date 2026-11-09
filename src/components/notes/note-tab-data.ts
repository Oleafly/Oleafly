import type { ProjectInfo } from "@oleafly/backend-port";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "@/lib/log";
import { noteHeads, noteLinks } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { NOTE_KIND } from "./note-file";
import type { NotesData } from "./notes-data";
import { createNotesService, noteHeadOf, noteItems, relatedProjectChoices } from "./notes-service";

const NONE: readonly never[] = [];

let shared: { signature: string; heads: ReadonlyMap<string, string> } | null = null;

export function forgetNoteTabHeads(): void {
  shared = null;
}

export function noteListSignature(projects: readonly ProjectInfo[]): string {
  return projects
    .filter((project) => project.kind === NOTE_KIND)
    .map((project) => `${project.id}\u0000${project.updated_at}`)
    .join("\u0001");
}

function useChangeCount(value: unknown): number {
  const seen = useRef({ value, count: 0 });
  if (seen.current.value !== value) seen.current = { value, count: seen.current.count + 1 };
  return seen.current.count;
}

const noHeads = () => undefined;

export function useNotesService(refreshHeads: () => void = noHeads, setHead?: (id: string, head: string) => void) {
  const { t } = useTranslation(["notes"]);
  const projects = useFilesStore((state) => state.projects);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const untitled = t(($) => $.notes.document.untitled);
  const missing = t(($) => $.notes.document.loadFailed);
  return useMemo(
    () =>
      createNotesService({
        projects: () => projectsRef.current,
        refreshProjects,
        refreshHeads,
        ...(setHead ? { setHead } : {}),
        untitled,
        missing,
      }),
    [missing, refreshHeads, refreshProjects, setHead, untitled],
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
  const signature = useMemo(() => noteListSignature(projects), [projects]);
  const signatureRef = useRef(signature);
  signatureRef.current = signature;
  const [heads, setHeads] = useState<ReadonlyMap<string, string>>(() => shared?.heads ?? new Map());
  const [headsLoaded, setHeadsLoaded] = useState(shared !== null);

  const refreshHeads = useCallback(() => {
    const asked = signatureRef.current;
    noteHeads().then(
      (list) => {
        const next = new Map(list.map((head) => [head.id, head.head]));
        shared = { signature: asked, heads: next };
        setHeads(next);
        setHeadsLoaded(true);
      },
      (error: unknown) => {
        setHeadsLoaded(true);
        void logError("read note heads for a note tab", error);
      },
    );
  }, []);

  const setHead = useCallback((id: string, head: string) => {
    setHeads((current) => {
      if (current.get(id) === head) return current;
      const next = new Map(current).set(id, head);
      if (shared) shared = { signature: shared.signature, heads: next };
      return next;
    });
  }, []);
  const noteTextChanged = useCallback((id: string, text: string) => setHead(id, noteHeadOf(text)), [setHead]);

  useEffect(() => {
    if (shared?.signature !== signature) refreshHeads();
  }, [refreshHeads, signature]);

  const ungrouped = t(($) => $.notes.library.ungrouped);
  const notes = useMemo(() => noteItems(projects, heads, ungrouped), [heads, projects, ungrouped]);
  const revision = useChangeCount(notes);
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  const service = useNotesService(refreshHeads, setHead);

  const data = useMemo<NotesData>(
    () => ({
      ...service,
      notes,
      revision,
      noteTextChanged,
      artifacts: NONE,
      experiments: NONE,
      papers: NONE,
      projects: choices,
      noteLinks,
      openProject: (projectId: string) => {
        useFilesStore
          .getState()
          .openProject(projectId)
          .catch((error: unknown) => logError("open a project from a note tab", error));
      },
    }),
    [choices, noteTextChanged, notes, revision, service],
  );

  return { data, headsLoaded };
}
