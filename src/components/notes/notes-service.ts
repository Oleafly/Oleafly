import type { ProjectInfo } from "@oleafly/backend-port";
import { splitMarkdownFrontMatter } from "@oleafly/wysiwyg/front-matter";
import { listen } from "@tauri-apps/api/event";
import { loadAssetThumbnail } from "@/components/editor/cm/hover-asset";
import { i18n } from "@/i18n";
import { diskHash } from "@/lib/disk-hash";
import { logError } from "@/lib/log";
import { sharedDocumentLive } from "@/lib/shared-document-writes";
import { pickOpenPath } from "@/lib/native-file-dialog";
import { copyResearchTaskArtifactToNote, previewResearchTaskArtifact } from "@/lib/research-tasks";
import {
  createNoteProject,
  listNoteTags,
  noteImportFile,
  noteSearch,
  projectFileSizes,
  readFileBase64,
  readFileContent,
  recycleProject,
  renameProjectCmd,
  setNoteRelatedProject,
  unwatchProjectFolder,
  watchProjectFolder,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { artifactPreview } from "./note-artifacts";
import { isNotebookPath, NOTEBOOK_MAX_BYTES, NotebookTooLargeError } from "./notebook-block";
import { NOTE_KIND, newNoteSource, readNoteFacts, withNoteColor, withNoteIcon, withNoteTitle } from "./note-file";
import { projectCitations } from "./note-citations";
import { notePreviewSource } from "./note-preview-source";
import { noteEditorOpen } from "@/lib/open-note-editors";
import { readProperties } from "./note-properties";
import { linkTargets } from "./note-link-format";
import { displayTags, frontMatterList, noteTags } from "./note-tags";
import { composeNoteSource } from "./note-templates";
import type { NotesData } from "./notes-data";
import { NoteConflictError, type NoteItem, type NoteSource } from "./types";

const FOLDER_CHANGED_EVENT = "project-folder-changed";

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
  | "createNote"
  | "watchNote"
  | "setRelatedProject"
  | "previewArtifact"
  | "copyArtifact"
  | "resolveAsset"
  | "importNotebook"
  | "searchNotes"
  | "noteTags"
  | "createNoteFrom"
  | "refreshNotes"
  | "projectCitations"
>;

export interface NotesServiceDeps {
  projects: () => readonly ProjectInfo[];
  refreshProjects: () => Promise<void>;
  refreshHeads: () => void;
  setHead?: (id: string, head: string, changed: boolean, knowledge: string) => void;
  untitled: string;
  missing: string;
}

const NOTE_HEAD_BYTES = 8 * 1024;
const headEncoder = new TextEncoder();
const headDecoder = new TextDecoder();

export function noteHeadOf(text: string): string {
  if (text.length * 3 <= NOTE_HEAD_BYTES) return text;
  let end = Math.min(text.length, NOTE_HEAD_BYTES);
  const last = text.charCodeAt(end - 1);
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end += 1;
  const bytes = headEncoder.encode(text.slice(0, end));
  if (bytes.length <= NOTE_HEAD_BYTES) return text.slice(0, end);
  let cut = NOTE_HEAD_BYTES;
  while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) cut -= 1;
  return headDecoder.decode(bytes.subarray(0, cut));
}

export function noteKnowledgeKey(text: string): string {
  const facts = readNoteFacts(text);
  return JSON.stringify([
    facts.title ?? "",
    frontMatterList(text, "aliases"),
    noteTags(text),
    linkTargets(text).map((link) => [link.kind, link.id, link.snippet]),
  ]);
}

interface HeadFacts {
  aliases: readonly string[];
  tags: readonly string[];
  properties: Readonly<Record<string, unknown>>;
}

const HEAD_CACHE_LIMIT = 4096;
let headCache = new Map<string, HeadFacts>();

export function headFacts(head: string): HeadFacts {
  const block = splitMarkdownFrontMatter(head).frontmatter;
  const properties = block ? (readProperties(block) ?? []) : [];
  return {
    aliases: frontMatterList(head, "aliases"),
    tags: displayTags(head),
    properties: Object.fromEntries(properties.map((property) => [property.key, property.value])),
  };
}

function cachedHeadFacts(head: string, next: Map<string, HeadFacts>): HeadFacts {
  const facts = next.get(head) ?? headCache.get(head) ?? headFacts(head);
  next.set(head, facts);
  return facts;
}

interface ItemInputs {
  head: string;
  name: string;
  related: string | undefined;
  relatedId: string | null | undefined;
  updatedAt: number;
  createdAt: number;
  shared: boolean;
  ungrouped: string;
}

interface CachedItem {
  inputs: ItemInputs;
  item: NoteItem;
}

function sameInputs(left: ItemInputs, right: ItemInputs): boolean {
  return (
    left.head === right.head &&
    left.name === right.name &&
    left.related === right.related &&
    left.relatedId === right.relatedId &&
    left.updatedAt === right.updatedAt &&
    left.createdAt === right.createdAt &&
    left.shared === right.shared &&
    left.ungrouped === right.ungrouped
  );
}

type NoteItemsOf = (projects: readonly ProjectInfo[], heads: ReadonlyMap<string, string>, ungrouped: string) => NoteItem[];

export function createNoteItems(): NoteItemsOf {
  let itemCache = new Map<string, CachedItem>();
  let lastItems: NoteItem[] = [];
  return (projects, heads, ungrouped) => {
    const built = buildNoteItems(projects, heads, ungrouped, itemCache, lastItems);
    itemCache = built.cache;
    lastItems = built.items;
    return built.items;
  };
}

export const noteItems: NoteItemsOf = createNoteItems();

function buildNoteItems(
  projects: readonly ProjectInfo[],
  heads: ReadonlyMap<string, string>,
  ungrouped: string,
  itemCache: ReadonlyMap<string, CachedItem>,
  lastItems: readonly NoteItem[],
): { items: NoteItem[]; cache: Map<string, CachedItem> } {
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const nextCache = new Map<string, HeadFacts>();
  const nextItems = new Map<string, CachedItem>();
  let reused = 0;
  const items = projects
    .filter((project) => project.kind === NOTE_KIND)
    .map((project): NoteItem => {
      const head = heads.get(project.id) ?? "";
      const related = project.related_project ? names.get(project.related_project) : undefined;
      const inputs: ItemInputs = {
        head,
        name: project.name,
        related,
        relatedId: project.related_project,
        updatedAt: project.updated_at,
        createdAt: project.created_at,
        shared: Boolean(project.shared),
        ungrouped,
      };
      const cached = itemCache.get(project.id);
      if (cached && sameInputs(cached.inputs, inputs)) {
        nextItems.set(project.id, cached);
        nextCache.set(head, headCache.get(head) ?? headFacts(head));
        if (lastItems[reused] === cached.item) reused += 1;
        return cached.item;
      }
      const facts = readNoteFacts(head);
      const extra = cachedHeadFacts(head, nextCache);
      const item: NoteItem = {
        id: project.id,
        title: project.name,
        project: related ?? ungrouped,
        relatedProjectId: related === undefined ? undefined : (project.related_project ?? undefined),
        updatedAt: project.updated_at * 1000,
        author: facts.agent ? "agent" : "you",
        agent: facts.agent,
        icon: facts.icon,
        color: facts.color,
        summary: facts.summary,
        createdAt: project.created_at * 1000,
        preview: notePreviewSource(head, project.name),
        aliases: extra.aliases,
        tags: extra.tags,
        properties: extra.properties,
        ...(project.shared ? { shared: true } : {}),
      };
      nextItems.set(project.id, { inputs, item });
      return item;
    });
  for (const [head, facts] of nextCache) headCache.set(head, facts);
  if (headCache.size > HEAD_CACHE_LIMIT) headCache = nextCache;
  if (reused === items.length && items.length === lastItems.length) return { items: lastItems as NoteItem[], cache: nextItems };
  return { items, cache: nextItems };
}

function lineEndings(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

function usesCrlf(disk: string): boolean {
  return /^[^\n]*\r\n/u.test(disk);
}

async function writeNoteFile(project: ProjectInfo, text: string, crlf: boolean): Promise<string> {
  const plain = lineEndings(text);
  await useFilesStore.getState().writeProjectFile(project.id, project.main_doc, plain, { closedProject: true, crlf });
  return crlf ? plain.replace(/\n/gu, "\r\n") : plain;
}

async function writeNoteTitle(project: ProjectInfo, title: string): Promise<void> {
  const text = await readFileContent(project.id, project.main_doc);
  const next = withNoteTitle(text, title);
  if (next !== text) await writeNoteFile(project, next, usesCrlf(text));
}

export function noteVersion(text: string): string {
  return diskHash(lineEndings(text));
}

async function readNote(project: ProjectInfo): Promise<NoteSource> {
  const text = await readFileContent(project.id, project.main_doc);
  return { text, version: noteVersion(text) };
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

async function importNotebook(noteId: string): Promise<string | null> {
  const source = await pickOpenPath({
    title: i18n.t(($) => $.notes.notebook.pickTitle),
    filters: [{ name: i18n.t(($) => $.notes.notebook.filter), extensions: ["ipynb"] }],
  });
  if (typeof source !== "string") return null;
  return (await noteImportFile(noteId, source)).path;
}

export function createNotesService(deps: NotesServiceDeps): NotesService {
  const projectOf = (id: string) => {
    const project = deps.projects().find((candidate) => candidate.id === id);
    if (!project) throw new Error(deps.missing);
    return project;
  };
  const updateHead = (id: string, text: string, changed: boolean) => {
    if (deps.setHead) deps.setHead(id, noteHeadOf(text), changed, noteKnowledgeKey(text));
    else deps.refreshHeads();
  };
  return {
    loadNote: async (id) => readNote(projectOf(id)),
    saveNote: async (id, text, version, base) => {
      const project = projectOf(id);
      const shared = base !== undefined && sharedDocumentLive(id) ? lineEndings(base) : null;
      let written = lineEndings(text);
      let changed: boolean;
      if (shared === null) {
        const disk = await readNote(project);
        if (disk.version !== version) throw new NoteConflictError(disk);
        written = await writeNoteFile(project, text, usesCrlf(disk.text));
        changed = disk.text !== written;
      } else {
        await useFilesStore.getState().writeProjectFile(id, project.main_doc, written, { base: shared, closedProject: true });
        changed = shared !== written;
      }
      updateHead(id, written, changed);
      return { text: written, version: noteVersion(written) };
    },
    renameNote: async (id, title) => {
      await renameProjectCmd(id, title);
      if (!noteEditorOpen(id)) {
        await writeNoteTitle(projectOf(id), title).catch((error: unknown) => logError("write the note title", error));
      }
      await deps.refreshProjects();
    },
    deleteNote: async (id) => {
      await recycleProject(id);
      await deps.refreshProjects();
      if (!deps.setHead) deps.refreshHeads();
    },
    createNote: async () => {
      const source = newNoteSource(deps.untitled);
      const id = await createNoteProject(deps.untitled, source);
      await deps.refreshProjects();
      updateHead(id, source, true);
      return id;
    },
    createNoteFrom: async (draft) => {
      const title = draft.title.trim() || deps.untitled;
      let base = newNoteSource(title, draft.body ?? "");
      if (draft.icon) base = withNoteIcon(base, draft.icon);
      if (draft.color) base = withNoteColor(base, draft.color);
      const source = composeNoteSource(base, draft.properties, draft.tags);
      const id = await createNoteProject(title, source, draft.relatedProject ?? null);
      await deps.refreshProjects();
      updateHead(id, source, true);
      return id;
    },
    refreshNotes: async () => {
      await deps.refreshProjects();
      deps.refreshHeads();
    },
    searchNotes: (query, limit) => noteSearch(query, limit),
    noteTags: () => listNoteTags(),
    watchNote: (id, onChange) => watchFile(id, projectOf(id).main_doc, onChange),
    setRelatedProject: async (id, projectId) => {
      await setNoteRelatedProject(id, projectId);
      await deps.refreshProjects();
    },
    previewArtifact: async (artifact) =>
      artifactPreview(artifact, (await previewResearchTaskArtifact(artifact.taskId, artifact.path)).content),
    copyArtifact: async (noteId, artifact) =>
      (await copyResearchTaskArtifactToNote(artifact.taskId, artifact.path, noteId)).path,
    resolveAsset: (noteId, path) => (isNotebookPath(path) ? notebookUrl(noteId, path) : loadAssetThumbnail(noteId, path)),
    importNotebook,
    projectCitations,
  };
}

export function relatedProjectChoices(projects: readonly ProjectInfo[]): { id: string; name: string }[] {
  return projects
    .filter((project) => project.kind !== NOTE_KIND && !project.recovery_pending)
    .sort((left, right) => right.updated_at - left.updated_at)
    .map((project) => ({ id: project.id, name: project.name }));
}
