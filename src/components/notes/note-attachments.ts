import type { FileEntry } from "@oleafly/backend-port";
import { normalizeText } from "@oleafly/search-query";
import { markdownReferences } from "@oleafly/wysiwyg";
import { scheduleIdle } from "@/lib/idle";
import { compareText } from "@/lib/intl";
import { logError } from "@/lib/log";
import { EDITOR_DOCUMENT_WAIT_MS } from "@/lib/open-location";
import { openNoteText } from "@/lib/open-note-editors";
import { basename } from "@/lib/path-utils";
import { foldPath, NOTE_FILE } from "@/lib/project-notes";
import { listFiles, projectFileSizes } from "@/lib/tauri";
import { parseMoleculeSource } from "./molecule-source";
import { noteBlockName } from "./note-blocks";
import { attachmentOf } from "./note-image-drop";
import { noteMarkdownExtensions } from "./note-markdown";
import { assetFragment, noteMediaKind, notePath } from "./note-path";
import { revealNoteLocation } from "./note-reveal";
import { NOTEBOOK_INFO, parseNotebookBlock } from "./notebook-block";
import { tableSource } from "./table-data";
import type { NoteItem, NoteSource } from "./types";

export const ATTACHMENT_TYPES = ["all", "image", "audio", "video", "pdf", "other"] as const;
export type AttachmentTypeFilter = (typeof ATTACHMENT_TYPES)[number];
export type AttachmentType = Exclude<AttachmentTypeFilter, "all">;
export const ATTACHMENT_USES = ["all", "unused"] as const;
export type AttachmentUse = (typeof ATTACHMENT_USES)[number];

const ASSETS = "assets/";
const ORIGINS = `${ASSETS}origins/`;
const READ_CONCURRENCY = 8;
const IDLE = { fallbackMs: 0, timeout: 250 } as const;

export interface NoteAttachment {
  key: string;
  noteId: string;
  path: string;
  name: string;
  size: number | null;
  type: AttachmentType;
  used: boolean;
}

export interface AttachmentSources {
  listFiles(noteId: string): Promise<readonly FileEntry[]>;
  fileSizes(noteId: string, paths: readonly string[]): Promise<Readonly<Record<string, number>>>;
  noteText(noteId: string): Promise<string>;
}

export type AttachmentRows = Map<string, { updatedAt: number; rows: readonly NoteAttachment[] }>;

interface AttachmentFilters {
  type: AttachmentTypeFilter;
  use: AttachmentUse;
  search: string;
}

interface NoteFileReference {
  path: string;
  line: number;
}

const FENCE_FILES = new Map<string, (source: string) => string | null>([
  [
    "csv",
    (source) => {
      const table = tableSource(source);
      return table.kind === "file" ? table.path : null;
    },
  ],
  [
    "molecule",
    (source) => {
      const parsed = parseMoleculeSource(source);
      return parsed.ok ? parsed.spec.path : null;
    },
  ],
  [
    NOTEBOOK_INFO,
    (source) => {
      const parsed = parseNotebookBlock(source);
      return parsed.ok ? parsed.block.path : null;
    },
  ],
]);

function slashed(path: string): string {
  return path.replaceAll("\\", "/");
}

function linkedFile(target: string): string | null {
  const path = notePath(target);
  return path === null ? null : slashed(assetFragment(path).file);
}

function fencedFile(info: string, content: string): string | null {
  const name = noteBlockName(info);
  const path = name === undefined ? null : (FENCE_FILES.get(name)?.(content) ?? null);
  return path === null ? null : slashed(path);
}

export function noteFileReferences(source: string): NoteFileReference[] {
  return markdownReferences(source, noteMarkdownExtensions()).flatMap((reference) => {
    const path = reference.kind === "fence" ? fencedFile(reference.info, reference.content) : linkedFile(reference.target);
    return path ? [{ path, line: reference.line }] : [];
  });
}

export function attachmentType(path: string): AttachmentType {
  const kind = attachmentOf(path);
  if (kind === "image") return "image";
  return (kind === "media" ? noteMediaKind(path) : null) ?? "other";
}

function isAttachment(entry: FileEntry): boolean {
  const folded = foldPath(slashed(entry.path));
  return !entry.is_dir && folded.startsWith(ASSETS) && !folded.startsWith(ORIGINS) && !basename(folded).startsWith(".");
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    scheduleIdle(() => resolve(), IDLE);
  });
}

async function usedFiles(noteId: string, sources: AttachmentSources): Promise<ReadonlySet<string>> {
  const text = await sources.noteText(noteId);
  await idle();
  return new Set(noteFileReferences(text).map((reference) => foldPath(reference.path)));
}

async function attachmentsOf(noteId: string, sources: AttachmentSources): Promise<NoteAttachment[]> {
  const files = (await sources.listFiles(noteId)).filter(isAttachment).map((entry) => entry.path);
  if (files.length === 0) return [];
  const [sizes, used] = await Promise.all([sources.fileSizes(noteId, files), usedFiles(noteId, sources)]);
  return files
    .map((path) => ({
      key: `${noteId}\u0000${path}`,
      noteId,
      path,
      name: basename(path),
      size: sizes[path] ?? null,
      type: attachmentType(path),
      used: used.has(foldPath(slashed(path))),
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

export async function noteAttachments(
  notes: readonly NoteItem[],
  sources: AttachmentSources,
  known: AttachmentRows = new Map(),
  changed: readonly string[] | null = null,
): Promise<NoteAttachment[]> {
  const ordered = [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
  const stale = new Set(changed);
  const fresh = ordered.filter((note) => stale.has(note.id) || known.get(note.id)?.updatedAt !== note.updatedAt);
  const failures: unknown[] = [];
  let cursor = 0;
  const read = async (): Promise<void> => {
    if (cursor >= fresh.length) return;
    const { id, updatedAt } = fresh[cursor];
    cursor += 1;
    try {
      known.set(id, { updatedAt, rows: await attachmentsOf(id, sources) });
    } catch (error) {
      known.delete(id);
      failures.push(error);
    }
    await read();
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, fresh.length) }, read));
  if (failures.length > 0 && failures.length === ordered.length) throw failures[0];
  if (failures.length > 0) void logError("list note attachments", failures[0]);
  const kept = new Set(ordered.map((note) => note.id));
  for (const id of known.keys()) if (!kept.has(id)) known.delete(id);
  return ordered.flatMap((note) => known.get(note.id)?.rows ?? []);
}

export function vaultAttachmentSources(loadNote: (noteId: string) => Promise<NoteSource>): AttachmentSources {
  return {
    listFiles,
    fileSizes: projectFileSizes,
    noteText: async (noteId) => openNoteText(noteId) ?? (await loadNote(noteId)).text,
  };
}

export function filterAttachments(
  items: readonly NoteAttachment[],
  filters: AttachmentFilters,
  titleOf: (noteId: string) => string,
): NoteAttachment[] {
  const words = normalizeText(filters.search).split(/\s+/u).filter(Boolean);
  return items.filter((item) => {
    if (filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.use === "unused" && item.used) return false;
    const text = words.length === 0 ? "" : normalizeText(`${item.name} ${titleOf(item.noteId)}`);
    return words.every((word) => text.includes(word));
  });
}

export function attachmentLine(source: string, path: string): number | null {
  const wanted = foldPath(slashed(path));
  return noteFileReferences(source).find((reference) => foldPath(reference.path) === wanted)?.line ?? null;
}

export async function revealAttachment(noteId: string, path: string, loadNote: (noteId: string) => Promise<NoteSource>): Promise<void> {
  const source = openNoteText(noteId) ?? (await loadNote(noteId)).text;
  const line = attachmentLine(source, path);
  if (line === null) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), EDITOR_DOCUMENT_WAIT_MS);
  try {
    await revealNoteLocation(noteId, source, { path: NOTE_FILE, line }, abort.signal, { select: true, focus: true });
  } finally {
    clearTimeout(timer);
  }
}
