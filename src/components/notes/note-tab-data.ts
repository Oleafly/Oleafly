import type { ProjectInfo } from "@oleafly/backend-port";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "@/lib/log";
import { noteHeads, noteLinks } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { NOTE_KIND } from "./note-file";
import type { NotesData } from "./notes-data";
import { createNotesService, noteHeadOf, noteItems, type NotesServiceDeps, relatedProjectChoices } from "./notes-service";

const NONE: readonly never[] = [];

const NO_HEADS: ReadonlyMap<string, string> = new Map();

let heads = NO_HEADS;
let loadedSignature: string | null = null;
let loading: { signature: string; done: Promise<void> } | null = null;
let vaultRevision = 0;
let vaultSignature: string | null = null;
let openTabs = 0;
const watchers = new Set<() => void>();
const knowledge = new Map<string, string>();

export function resetNoteTabHeadsForTest(): void {
  heads = NO_HEADS;
  loadedSignature = null;
  loading = null;
  vaultRevision += 1;
  vaultSignature = null;
  knowledge.clear();
}

function notify(): void {
  for (const wake of [...watchers]) wake();
}

function watch(wake: () => void): () => void {
  watchers.add(wake);
  return () => {
    watchers.delete(wake);
  };
}

const readHeads = () => heads;
const readLoaded = () => loadedSignature !== null;
const readVault = () => vaultRevision;

function bumpVault(): void {
  vaultRevision += 1;
  notify();
}

function loadHeads(signature: string): Promise<void> {
  if (loading?.signature === signature) return loading.done;
  const done = noteHeads()
    .then((list) => {
      heads = new Map(list.map((head) => [head.id, head.head]));
      loadedSignature = signature;
      notify();
    })
    .finally(() => {
      if (loading?.done === done) loading = null;
    });
  loading = { signature, done };
  return done;
}

function applyHead(id: string, head: string): void {
  if (heads.get(id) === head) return;
  heads = new Map(heads).set(id, head);
  notify();
}

function savedHead(id: string, head: string, changed: boolean, key: string): void {
  applyHead(id, head);
  const known = knowledge.get(id);
  knowledge.set(id, key);
  if (changed && known !== key) bumpVault();
}

function noteTextChanged(id: string, text: string): void {
  applyHead(id, noteHeadOf(text));
}

const tabNoteLinks = () => noteLinks();

function useVaultRevision(signature: string): number {
  useState(() => {
    if (openTabs === 0) vaultRevision += 1;
  });
  useEffect(() => {
    openTabs += 1;
    return () => {
      openTabs -= 1;
    };
  }, []);
  useEffect(() => {
    if (vaultSignature !== null && vaultSignature !== signature) bumpVault();
    vaultSignature = signature;
  }, [signature]);
  return useSyncExternalStore(watch, readVault);
}

export function noteListSignature(projects: readonly ProjectInfo[]): string {
  return projects
    .filter((project) => project.kind === NOTE_KIND)
    .map((project) => `${project.id}\u0000${project.updated_at}`)
    .join("\u0001");
}

const noHeads = () => undefined;

export function useNotesService(refreshHeads: () => void = noHeads, setHead?: NotesServiceDeps["setHead"]) {
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
  const shownHeads = useSyncExternalStore(watch, readHeads);
  const loaded = useSyncExternalStore(watch, readLoaded);
  const [failed, setFailed] = useState(false);

  const refreshHeads = useCallback(() => {
    loadHeads(signatureRef.current).catch((error: unknown) => {
      setFailed(true);
      void logError("read note heads for a note tab", error);
    });
  }, []);

  useEffect(() => {
    if (loadedSignature !== signature) refreshHeads();
  }, [refreshHeads, signature]);

  const ungrouped = t(($) => $.notes.library.ungrouped);
  const notes = useMemo(() => noteItems(projects, shownHeads, ungrouped), [projects, shownHeads, ungrouped]);
  const revision = useVaultRevision(signature);
  const choices = useMemo(() => relatedProjectChoices(projects), [projects]);
  const service = useNotesService(refreshHeads, savedHead);

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
      noteLinks: tabNoteLinks,
      openProject: (projectId: string) => {
        useFilesStore
          .getState()
          .openProject(projectId)
          .catch((error: unknown) => logError("open a project from a note tab", error));
      },
    }),
    [choices, notes, revision, service],
  );

  return { data, headsLoaded: loaded || failed };
}
