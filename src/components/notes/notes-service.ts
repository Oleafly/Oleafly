import type { ProjectInfo } from "@oleafly/backend-port";
import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef } from "react";
import { loadAssetThumbnail } from "@/components/editor/cm/hover-asset";
import { diskHash } from "@/lib/disk-hash";
import { setScalar } from "@/lib/front-matter-yaml";
import { logError } from "@/lib/log";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { noteEditorOpen } from "@/lib/open-note-editors";
import { NOTE_FILE_KIND } from "@/lib/project-notes";
import { appQueryClient } from "@/lib/query";
import { copyResearchTaskArtifactToNote, previewResearchTaskArtifact } from "@/lib/research-tasks";
import { sharedDocumentLive } from "@/lib/shared-document-writes";
import {
  createNoteProject,
  listNoteTags,
  listNoteTasks,
  type NoteFacts,
  noteFacts,
  noteImportFile,
  noteSearch,
  projectFileSizes,
  readFileBase64,
  readFileContent,
  readNoteFile,
  recycleProject,
  renameProjectCmd,
  revealProject,
  setNoteRelatedProject,
  unwatchProjectFolder,
  watchProjectFolder,
} from "@/lib/tauri";
import { isDiskConflict, useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import { artifactPreview } from "./note-artifacts";
import { projectCitations } from "./note-citations";
import { newNoteSource, noteColorOf, noteSummary, withNoteColor, withNoteIcon, withNoteTitle } from "./note-file";
import { forgetNoteLeftovers } from "./note-pending-suggestions";
import { copyNoteAssets } from "./project-note-actions";
import { composeNoteSource } from "./note-templates";
import { isNotebookPath, NOTEBOOK_MAX_BYTES, NotebookTooLargeError } from "./notebook-block";
import { assetFragment, NOTE_FILE_MAX_BYTES, noteMediaKind, noteMediaType } from "./note-path";
import type { AttachFilter, NotesData } from "./notes-data";
import { closeSavedNoteView } from "./notes-layout";
import { NoteConflictError, type NoteItem, type NoteSource } from "./types";

const FOLDER_CHANGED_EVENT = "project-folder-changed";
const NOTE_FACTS_KEY = ["notes", "facts"] as const;

interface FolderChange {
  projectId: string;
  paths: string[];
  rescan: boolean;
}

export type NotesService = Pick<
  NotesData,
  | "loadNote"
  | "saveNote"
  | "renameNote"
  | "deleteNote"
  | "duplicateNote"
  | "createNote"
  | "watchNote"
  | "setRelatedProject"
  | "previewArtifact"
  | "copyArtifact"
  | "resolveAsset"
  | "revealAsset"
  | "attachFile"
  | "searchNotes"
  | "noteTags"
  | "noteTasks"
  | "createNoteFrom"
  | "refreshNotes"
  | "projectCitations"
>;

export interface NotesServiceDeps {
  projects: () => readonly ProjectInfo[];
  refreshProjects: () => Promise<void>;
  untitled: string;
  missing: string;
}

export interface VaultFacts {
  facts: readonly NoteFacts[];
  revision: number;
  changed: readonly string[] | null;
  taskRevision: number;
}

let revisions = 0;
let taskRevisions = 0;

function changedNotes(before: readonly NoteFacts[], after: readonly NoteFacts[], part: "knowledge" | "taskDigest"): string[] {
  const known = new Map(before.map((fact) => [fact.id, fact[part]]));
  const changed = after.filter((fact) => known.get(fact.id) !== fact[part]).map((fact) => fact.id);
  const kept = new Set(after.map((fact) => fact.id));
  return [...changed, ...before.filter((fact) => !kept.has(fact.id)).map((fact) => fact.id)];
}

function nextFacts(previous: VaultFacts | undefined, facts: readonly NoteFacts[]): VaultFacts {
  if (!previous) {
    revisions += 1;
    taskRevisions += 1;
    return { facts, revision: revisions, changed: null, taskRevision: taskRevisions };
  }
  let taskRevision = previous.taskRevision;
  if (changedNotes(previous.facts, facts, "taskDigest").length > 0) {
    taskRevisions += 1;
    taskRevision = taskRevisions;
  }
  const changed = changedNotes(previous.facts, facts, "knowledge");
  if (changed.length === 0) return { ...previous, facts, taskRevision };
  revisions += 1;
  return { facts, revision: revisions, changed, taskRevision };
}

function patched(facts: readonly NoteFacts[], ids: readonly string[], fresh: readonly NoteFacts[]): NoteFacts[] {
  const wanted = new Set(ids);
  const byId = new Map(fresh.filter((fact) => wanted.has(fact.id)).map((fact) => [fact.id, fact]));
  const next = facts.flatMap((fact) => {
    if (!wanted.has(fact.id)) return [fact];
    const replaced = byId.get(fact.id);
    byId.delete(fact.id);
    return replaced ? [replaced] : [];
  });
  return [...next, ...byId.values()];
}

function loadVaultFacts(): Promise<VaultFacts> {
  return noteFacts().then((facts) => nextFacts(appQueryClient().getQueryData<VaultFacts>(NOTE_FACTS_KEY), facts ?? []));
}

export async function refreshNoteFacts(ids: readonly string[]): Promise<void> {
  const client = appQueryClient();
  if (!client.getQueryData(NOTE_FACTS_KEY)) return;
  const fresh = (await noteFacts({ ids })) ?? [];
  client.setQueryData<VaultFacts>(NOTE_FACTS_KEY, (current) => current && nextFacts(current, patched(current.facts, ids, fresh)));
}

export function reloadVaultFacts(): Promise<void> {
  return appQueryClient().invalidateQueries({ queryKey: NOTE_FACTS_KEY });
}

function noteNamesOf(projects: readonly ProjectInfo[]): string {
  return projects
    .filter((project) => project.kind === NOTE_FILE_KIND)
    .map((project) => `${project.id}\u0000${project.name}`)
    .join("\u0001");
}

export function useVaultFacts(projects: readonly ProjectInfo[]): { vault: VaultFacts | undefined; failed: boolean } {
  const query = useQuery({ queryKey: NOTE_FACTS_KEY, queryFn: loadVaultFacts }, appQueryClient());
  const names = useMemo(() => noteNamesOf(projects), [projects]);
  const seen = useRef(names);
  useEffect(() => {
    if (seen.current === names) return;
    seen.current = names;
    void reloadVaultFacts();
  }, [names]);
  return { vault: query.data, failed: query.isError };
}

interface CachedItem {
  inputs: readonly unknown[];
  item: NoteItem;
}

type NoteItemsOf = (projects: readonly ProjectInfo[], facts: readonly NoteFacts[] | undefined, ungrouped: string) => NoteItem[];

function itemOf(project: ProjectInfo, fact: NoteFacts | undefined, related: string | undefined, ungrouped: string): NoteItem {
  return {
    id: project.id,
    title: project.name,
    project: related ?? ungrouped,
    relatedProjectId: related === undefined ? undefined : (project.related_project ?? undefined),
    updatedAt: project.updated_at * 1000,
    author: fact?.agent ? "agent" : "you",
    agent: fact?.agent ?? undefined,
    icon: fact?.icon ?? undefined,
    color: noteColorOf(fact?.color, fact?.noteId ?? project.name),
    summary: noteSummary(fact?.preview ?? ""),
    createdAt: project.created_at * 1000,
    preview: fact?.preview,
    aliases: fact?.aliases,
    tags: fact?.tags,
    properties: fact?.properties,
    ...(fact?.noteId ? { noteId: fact.noteId } : {}),
    ...(project.shared ? { shared: true } : {}),
  };
}

export function createNoteItems(): NoteItemsOf {
  let cache = new Map<string, CachedItem>();
  let last: NoteItem[] = [];
  return (projects, facts, ungrouped) => {
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const factsById = new Map((facts ?? []).map((fact) => [fact.id, fact]));
    const next = new Map<string, CachedItem>();
    const items = projects
      .filter((project) => project.kind === NOTE_FILE_KIND)
      .map((project) => {
        const fact = factsById.get(project.id);
        const related = project.related_project ? names.get(project.related_project) : undefined;
        const inputs = [fact, project.name, related, project.related_project, project.updated_at, project.created_at, Boolean(project.shared), ungrouped];
        const cached = cache.get(project.id);
        const entry = cached?.inputs.every((input, index) => Object.is(input, inputs[index])) ? cached : { inputs, item: itemOf(project, fact, related, ungrouped) };
        next.set(project.id, entry);
        return entry.item;
      });
    cache = next;
    if (items.length !== last.length || items.some((item, index) => item !== last[index])) last = items;
    return last;
  };
}

export function lfLineEndings(text: string): string {
  return text.replaceAll(/\r\n?/gu, "\n");
}

export function usesCrlf(disk: string): boolean {
  return /^[^\n]*\r\n/u.test(disk);
}

export function noteVersion(text: string): string {
  return diskHash(lfLineEndings(text));
}

interface DiskState {
  version: string;
  hash: string;
  crlf: boolean;
}

interface LocalWrite {
  text: string;
  version: string;
  changed: boolean;
}

function diskStateOf(raw: string): DiskState {
  const version = noteVersion(raw);
  return { version, hash: raw.includes("\r") ? diskHash(raw) : version, crlf: usesCrlf(raw) };
}

async function writeNoteFile(
  project: ProjectInfo,
  text: string,
  crlf: boolean,
  expectedHash?: string,
): Promise<{ text: string; state: DiskState }> {
  const plain = lfLineEndings(text);
  await useFilesStore.getState().writeProjectFile(project.id, project.main_doc, plain, {
    closedProject: true,
    crlf,
    ...(expectedHash === undefined ? {} : { expectedHash }),
  });
  const written = crlf ? plain.replaceAll("\n", "\r\n") : plain;
  return { text: written, state: diskStateOf(written) };
}

async function writeNoteTitle(project: ProjectInfo, title: string): Promise<void> {
  const text = await readFileContent(project.id, project.main_doc);
  const next = withNoteTitle(text, title);
  if (next !== text) {
    await recordNoteWrite(project.id, next, () => writeNoteFile(project, next, usesCrlf(text), diskStateOf(text).hash));
  }
}

async function readNote(project: ProjectInfo): Promise<{ source: NoteSource; state: DiskState }> {
  const text = await readFileContent(project.id, project.main_doc);
  const state = diskStateOf(text);
  return { source: { text, version: state.version }, state };
}

const KEPT_STATES = 64;
const WRITE_ATTEMPTS = 3;

function keep<T>(states: Map<string, T>, id: string, value: T): void {
  states.delete(id);
  states.set(id, value);
  if (states.size > KEPT_STATES) states.delete(states.keys().next().value as string);
}

interface NoteWrite {
  version: string;
  landed: boolean;
}

const WRITES_PER_NOTE = 8;
const noteWrites = new Map<string, NoteWrite[]>();

function startNoteWrite(id: string, text: string): (landed: boolean) => void {
  const write: NoteWrite = { version: noteVersion(text), landed: false };
  keep(noteWrites, id, [...(noteWrites.get(id) ?? []), write].slice(-WRITES_PER_NOTE));
  return (landed) => {
    const kept = (noteWrites.get(id) ?? []).filter((known) => known !== write && !(landed && known.landed));
    if (landed) kept.push({ ...write, landed: true });
    if (kept.length > 0) noteWrites.set(id, kept);
    else noteWrites.delete(id);
  };
}

export async function recordNoteWrite<T>(id: string, text: string, write: () => Promise<T>): Promise<T> {
  const settle = startNoteWrite(id, text);
  try {
    const written = await write();
    settle(true);
    return written;
  } catch (error) {
    settle(false);
    throw error;
  }
}

export function noteWrittenHere(id: string, text: string): boolean {
  const writes = noteWrites.get(id);
  if (!writes) return false;
  const version = noteVersion(text);
  return writes.some((write) => write.version === version);
}

export function resetNoteWritesForTest(): void {
  noteWrites.clear();
}

function namesFile(path: string, mainDoc: string): boolean {
  return path === mainDoc || path.endsWith(`/${mainDoc}`) || path.endsWith(`\\${mainDoc}`);
}

function watchFile(projectId: string, mainDoc: string, onChange: () => void): () => void {
  let stopped = false;
  const token = watchProjectFolder(projectId).catch((error) => {
    void logError("watch note folder", error);
    return null;
  });
  const unlisten = listen<FolderChange>(FOLDER_CHANGED_EVENT, (event) => {
    const change = event.payload;
    if (stopped || change.projectId !== projectId) return;
    if (change.rescan || change.paths.some((path) => namesFile(path, mainDoc))) onChange();
  });
  return () => {
    stopped = true;
    void unlisten.then((stop) => stop());
    void token.then((id) => {
      if (id !== null) {
        void unwatchProjectFolder(projectId, id).catch((error) => logError("stop watching note folder", error));
      }
    });
  };
}

export async function notebookUrl(noteId: string, path: string): Promise<string | null> {
  const size = (await projectFileSizes(noteId, [path]))[path];
  if (size === undefined) return null;
  if (size > NOTEBOOK_MAX_BYTES) throw new NotebookTooLargeError();
  return `data:application/x-ipynb+json;base64,${await readFileBase64(noteId, path)}`;
}

async function mediaUrl(projectId: string, path: string): Promise<string | null> {
  const size = (await projectFileSizes(projectId, [path]))[path];
  if (size === undefined) return null;
  if (size > NOTE_FILE_MAX_BYTES) throw new Error(`${path} is larger than 64 MiB.`);
  return URL.createObjectURL(new Blob([await readNoteFile(projectId, path)], { type: noteMediaType(path) }));
}

export function noteAssetUrl(projectId: string, path: string): Promise<string | null> {
  const { file, page } = assetFragment(path);
  if (isNotebookPath(file)) return notebookUrl(projectId, file);
  const kind = noteMediaKind(file);
  if (kind === "audio" || kind === "video") return mediaUrl(projectId, file);
  return loadAssetThumbnail(projectId, file, page ?? 1);
}

async function attachFile(noteId: string, { title, name, extensions }: AttachFilter): Promise<string | null> {
  const source = await pickOpenPath({ title, filters: [{ name, extensions: [...extensions] }] });
  if (typeof source !== "string") return null;
  return (await noteImportFile(noteId, source)).path;
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const projectOf = (id: string) => {
    const project = deps.projects().find((candidate) => candidate.id === id);
    if (!project) throw new Error(deps.missing);
    return project;
  };
  const disk = new Map<string, DiskState>();
  const changed = (id: string, moved: boolean) => {
    if (moved) void refreshNoteFacts([id]).catch((error: unknown) => logError("read a changed note's facts", error));
  };
  const created = async (id: string) => {
    await deps.refreshProjects();
    await refreshNoteFacts([id]);
    return id;
  };
  const load = async (project: ProjectInfo) => {
    const read = await readNote(project);
    const known = disk.get(project.id)?.version;
    keep(disk, project.id, read.state);
    changed(project.id, known !== undefined && known !== read.state.version);
    return read;
  };
  const writeAttempt = async (
    project: ProjectInfo,
    text: string,
    version: string,
    known: DiskState | undefined,
    attempt: number,
  ): Promise<LocalWrite> => {
    let state = known;
    if (state?.version !== version) {
      const read = await load(project);
      if (read.state.version !== version) throw new NoteConflictError(read.source);
      state = read.state;
    }
    try {
      const written = await writeNoteFile(project, text, state.crlf, state.hash);
      keep(disk, project.id, written.state);
      return { text: written.text, version: written.state.version, changed: written.state.version !== state.version };
    } catch (error) {
      if (!isDiskConflict(error)) throw error;
      if (attempt >= WRITE_ATTEMPTS) throw new NoteConflictError((await load(project)).source);
    }
    return writeAttempt(project, text, version, undefined, attempt + 1);
  };
  const writeLocal = (project: ProjectInfo, text: string, version: string) =>
    writeAttempt(project, text, version, sharedDocumentLive(project.id) ? undefined : disk.get(project.id), 1);
  return {
    loadNote: async (id) => (await load(projectOf(id))).source,
    saveNote: (id, text, version, base) =>
      recordNoteWrite(id, text, async () => {
        const project = projectOf(id);
        const shared = base !== undefined && sharedDocumentLive(id) ? lfLineEndings(base) : null;
        if (shared === null) {
          const written = await writeLocal(project, text, version);
          changed(id, written.changed);
          return { text: written.text, version: written.version };
        }
        const written = lfLineEndings(text);
        disk.delete(id);
        await useFilesStore.getState().writeProjectFile(id, project.main_doc, written, { base: shared, closedProject: true });
        changed(id, shared !== written);
        return { text: written, version: noteVersion(written) };
      }),
    renameNote: async (id, title) => {
      await renameProjectCmd(id, title);
      if (!noteEditorOpen(id)) {
        await writeNoteTitle(projectOf(id), title).catch((error: unknown) => logError("write the note title", error));
      }
      await deps.refreshProjects();
    },
    deleteNote: async (id) => {
      await recycleProject(id);
      forgetNoteLeftovers(id);
      useNoteTabsStore.getState().close(id);
      closeSavedNoteView(id);
      await deps.refreshProjects();
    },
    duplicateNote: async (id, title) => {
      const project = projectOf(id);
      const text = await readFileContent(project.id, project.main_doc);
      const copy = setScalar(withNoteTitle(text, title), "id", crypto.randomUUID());
      const copied = await createNoteProject(title, copy, project.related_project ?? null);
      await copyNoteAssets(id, copied);
      return created(copied);
    },
    createNote: async () => created(await createNoteProject(deps.untitled, newNoteSource(deps.untitled))),
    createNoteFrom: async (draft) => {
      const title = draft.title.trim() || deps.untitled;
      let base = newNoteSource(title, draft.body ?? "");
      if (draft.icon) base = withNoteIcon(base, draft.icon);
      if (draft.color) base = withNoteColor(base, draft.color);
      const source = composeNoteSource(base, draft.properties, draft.tags);
      return created(await createNoteProject(title, source, draft.relatedProject ?? null));
    },
    refreshNotes: async () => {
      await deps.refreshProjects();
      await reloadVaultFacts();
    },
    searchNotes: (query, limit, options) => noteSearch(query, limit, options),
    noteTags: () => listNoteTags(),
    noteTasks: () => listNoteTasks(),
    watchNote: (id, onChange) => watchFile(id, projectOf(id).main_doc, onChange),
    setRelatedProject: async (id, projectId) => {
      await setNoteRelatedProject(id, projectId);
      await deps.refreshProjects();
    },
    previewArtifact: async (artifact) =>
      artifactPreview(artifact, (await previewResearchTaskArtifact(artifact.taskId, artifact.path)).content),
    copyArtifact: async (noteId, artifact) =>
      (await copyResearchTaskArtifactToNote(artifact.taskId, artifact.path, noteId)).path,
    resolveAsset: noteAssetUrl,
    revealAsset: (noteId, path) => revealProject(noteId, assetFragment(path).file),
    attachFile,
    projectCitations,
  };
}

export function relatedProjectChoices(projects: readonly ProjectInfo[]): { id: string; name: string }[] {
  return projects
    .filter((project) => project.kind !== NOTE_FILE_KIND && !project.recovery_pending)
    .sort((left, right) => right.updated_at - left.updated_at)
    .map((project) => ({ id: project.id, name: project.name }));
}
