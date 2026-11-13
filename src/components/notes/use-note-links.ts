import { type QueryKey, useQuery } from "@tanstack/react-query";
import type { AnyExtension } from "@tiptap/core";
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { logError } from "@/lib/log";
import { openNoteEditor } from "@/lib/open-note-editors";
import { notifyError } from "@/lib/toast";
import { i18n } from "@/i18n";
import { appQueryClient } from "@/lib/query";
import { keepSame } from "@/lib/same-value";
import type { NoteLinkRecord } from "@/lib/tauri";
import { isLinkableId, noteHeadings, targetKey, type NoteHeading } from "./note-link-format";
import { assignNoteBlockId, noteBlocks } from "./note-block-links";
import {
  blockChoices,
  docBlockChoices,
  linkedNoteCreator,
  noteLinkExtensions,
  type BlockChoice,
  type LinkableNote,
  type LinkableProject,
  type OpenNoteHandler,
  type OpenProjectHandler,
} from "./note-links";
import { useNotesData, useVaultKey, VAULT_QUERY, type VaultLoad } from "./notes-data";
import { useNotesByLook } from "./note-signature";
import { useProjectColor, type ProjectColorOf } from "./project-color";
import type { NoteItem } from "./types";

export interface BlockBacklink {
  block: string;
  snippet: string;
}

export interface Backlink {
  projectId: string;
  noteId: string | null;
  title: string;
  snippet: string;
  color?: string;
  icon?: string;
  blocks?: readonly BlockBacklink[];
}

export interface NoteLinkIndex {
  notes: readonly LinkableNote[] | null;
  projects: readonly LinkableProject[] | null;
  backlinks: ReadonlyMap<string, readonly Backlink[]>;
}

const NONE: readonly Backlink[] = [];

function linkableNotes(notes: readonly NoteItem[], byProject: ReadonlyMap<string, NoteLinkRecord>): LinkableNote[] {
  return notes.flatMap((note): LinkableNote[] => {
    const noteId = note.noteId ?? byProject.get(note.id)?.noteId;
    if (!isLinkableId(noteId)) return [];
    const linkable: LinkableNote = { noteId, projectId: note.id, title: note.title, color: note.color, icon: note.icon };
    if (note.aliases && note.aliases.length > 0) linkable.aliases = note.aliases;
    return [linkable];
  });
}

interface TargetLinks {
  snippet: string;
  blocks: BlockBacklink[];
}

function linksByTarget(record: NoteLinkRecord): Map<string, TargetLinks> {
  const added = new Map<string, TargetLinks>();
  for (const link of record.links) {
    if (link.kind === "note" && link.id === record.noteId) continue;
    const key = targetKey(link);
    const entry = added.get(key) ?? { snippet: link.snippet, blocks: [] };
    if (link.block) entry.blocks.push({ block: link.block, snippet: link.snippet });
    added.set(key, entry);
  }
  return added;
}

export function buildNoteLinkIndex(
  records: readonly NoteLinkRecord[] | null,
  notes: readonly NoteItem[],
  projects: readonly { id: string; name: string }[] | undefined,
  colorOf: ProjectColorOf,
): NoteLinkIndex {
  const items = new Map(notes.map((note) => [note.id, note]));
  const byProject = new Map((records ?? []).map((record) => [record.projectId, record]));
  const known = records !== null || notes.some((note) => note.noteId !== undefined);
  const linkable = known ? linkableNotes(notes, byProject) : null;
  const backlinks = new Map<string, Backlink[]>();
  for (const record of records ?? []) {
    const source = items.get(record.projectId);
    if (!source) continue;
    for (const [key, { snippet, blocks }] of linksByTarget(record)) {
      const backlink: Backlink = {
        projectId: record.projectId,
        noteId: record.noteId,
        title: source.title,
        snippet,
        color: source.color,
        icon: source.icon,
      };
      if (blocks.length > 0) backlink.blocks = blocks;
      const list = backlinks.get(key) ?? [];
      list.push(backlink);
      backlinks.set(key, list);
    }
  }
  for (const list of backlinks.values()) list.sort((left, right) => left.title.localeCompare(right.title));
  return {
    notes: linkable,
    projects: projects
      ? projects.map((project) => ({ projectId: project.id, title: project.name, color: colorOf(project.id) }))
      : null,
    backlinks,
  };
}

export function keepUnchanged(previous: NoteLinkIndex | null, next: NoteLinkIndex): NoteLinkIndex {
  if (!previous) return next;
  const kept = { notes: keepSame(previous.notes, next.notes), projects: keepSame(previous.projects, next.projects), backlinks: keepSame(previous.backlinks, next.backlinks) };
  return kept.notes === previous.notes && kept.projects === previous.projects && kept.backlinks === previous.backlinks ? previous : kept;
}

const EMPTY_INDEX: NoteLinkIndex = { notes: null, projects: null, backlinks: new Map() };
const SharedIndex = createContext<NoteLinkIndex | null>(null);

function previousRecords(key: QueryKey): readonly NoteLinkRecord[] | undefined {
  const revision = key[3];
  return typeof revision === "number" ? appQueryClient().getQueryData([...key.slice(0, 3), revision - 1]) : undefined;
}

async function linkRecords(
  key: QueryKey,
  load: (ids?: readonly string[]) => Promise<readonly NoteLinkRecord[]>,
  changed: readonly string[] | null | undefined,
): Promise<readonly NoteLinkRecord[]> {
  const previous = changed && changed.length > 0 ? previousRecords(key) : undefined;
  if (!previous || !changed) return load();
  const ids = new Set(changed);
  const fresh = (await load(changed)).filter((record) => ids.has(record.projectId));
  return [...previous.filter((record) => !ids.has(record.projectId)), ...fresh];
}

export function useNoteLinkRecords(enabled = true): VaultLoad<readonly NoteLinkRecord[]> {
  const { noteLinks, changedNotes } = useNotesData();
  const queryKey = useVaultKey("links", noteLinks);
  const changed = useRef(changedNotes);
  changed.current = changedNotes;
  const query = useQuery(
    {
      queryKey,
      queryFn: () => linkRecords(queryKey, noteLinks as NonNullable<typeof noteLinks>, changed.current),
      enabled: enabled && noteLinks !== undefined,
      ...VAULT_QUERY,
    },
    appQueryClient(),
  );
  return { data: query.data ?? null, failed: query.isError };
}

export function NoteLinkIndexProvider({ children }: Readonly<{ children: ReactNode }>) {
  const data = useNotesData();
  const notes = useNotesByLook(data.notes);
  const colorOf = useProjectColor();
  const records = useNoteLinkRecords().data;
  const previous = useRef<NoteLinkIndex | null>(null);
  const index = useMemo(() => {
    previous.current = keepUnchanged(previous.current, buildNoteLinkIndex(records, notes, data.projects, colorOf));
    return previous.current;
  }, [colorOf, data.projects, notes, records]);
  return createElement(SharedIndex.Provider, { value: index }, children);
}

export function FrozenNoteLinkIndex({ live, children }: Readonly<{ live: boolean; children: ReactNode }>) {
  const index = useContext(SharedIndex);
  const kept = useRef(index);
  if (live) kept.current = index;
  return index === null ? children : createElement(SharedIndex.Provider, { value: kept.current }, children);
}

export function useNoteLinkIndex(): NoteLinkIndex {
  return useContext(SharedIndex) ?? EMPTY_INDEX;
}

export function backlinksOf(index: NoteLinkIndex, noteId: string | null | undefined): readonly Backlink[] {
  return isLinkableId(noteId) ? (index.backlinks.get(targetKey({ kind: "note", id: noteId })) ?? NONE) : NONE;
}

export function useNoteBacklinks(noteId: string | null | undefined): readonly Backlink[] {
  return backlinksOf(useNoteLinkIndex(), noteId);
}

export function blockBacklinks(backlinks: readonly Backlink[], block: string): Backlink[] {
  return backlinks.flatMap((backlink) => {
    const found = backlink.blocks?.find((entry) => entry.block === block);
    return found ? [{ ...backlink, snippet: found.snippet }] : [];
  });
}

export function blockLinkCounts(backlinks: readonly Backlink[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const backlink of backlinks) {
    for (const block of new Set(backlink.blocks?.map((entry) => entry.block))) counts.set(block, (counts.get(block) ?? 0) + 1);
  }
  return counts;
}

export interface NoteLinkHandlers {
  currentProjectId?: string | null;
  onOpenNote: OpenNoteHandler;
  onOpenProject: OpenProjectHandler;
}

interface CachedText<T> {
  updatedAt: number;
  value: T | null;
}

const TEXTS_KEPT = 32;

export class NoteTextCache<T> {
  private readonly entries = new Map<string, CachedText<T>>();

  constructor(
    private readonly load: (projectId: string) => Promise<string>,
    private readonly derive: (text: string) => T,
    private readonly fallback: T,
    private readonly changed: () => void,
  ) {}

  get(projectId: string, updatedAt: number): T | null {
    const cached = this.entries.get(projectId);
    if (cached?.updatedAt === updatedAt) return cached.value;
    const entry: CachedText<T> = { updatedAt, value: null };
    this.entries.delete(projectId);
    this.entries.set(projectId, entry);
    if (this.entries.size > TEXTS_KEPT) this.entries.delete(this.entries.keys().next().value as string);
    this.load(projectId).then(
      (text) => {
        if (this.entries.get(projectId) !== entry) return;
        entry.value = this.derive(text);
        this.changed();
      },
      (error: unknown) => {
        if (this.entries.get(projectId) !== entry) return;
        entry.value = this.fallback;
        void logError("read a linked note", error);
        this.changed();
      },
    );
    return null;
  }
}

const NO_HEADINGS: readonly NoteHeading[] = [];
const NO_BLOCKS: readonly BlockChoice[] = [];

function blocksOfText(text: string): readonly BlockChoice[] {
  return blockChoices(noteBlocks(text));
}

export function useNoteLinkExtensions(handlers: NoteLinkHandlers): { extensions: AnyExtension[]; index: NoteLinkIndex } {
  const index = useNoteLinkIndex();
  const { notes, loadNote, saveNote, createNoteFrom } = useNotesData();
  const indexRef = useRef(index);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const loadRef = useRef(loadNote);
  loadRef.current = loadNote;
  const saveRef = useRef(saveNote);
  saveRef.current = saveNote;
  const createRef = useRef(createNoteFrom);
  createRef.current = createNoteFrom;
  const canCreate = createNoteFrom !== undefined;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [listeners] = useState(() => new Set<() => void>());
  const [caches] = useState(() => {
    const load = (projectId: string) => loadRef.current(projectId).then((source) => source.text);
    const changed = () => {
      for (const listener of listeners) listener();
    };
    return {
      headings: new NoteTextCache(load, noteHeadings, NO_HEADINGS, changed),
      blocks: new NoteTextCache(load, blocksOfText, NO_BLOCKS, changed),
    };
  });
  const current = handlers.currentProjectId ?? null;

  const linkable = index.notes;
  const projects = index.projects;
  useEffect(() => {
    if (indexRef.current.notes === linkable && indexRef.current.projects === projects) {
      indexRef.current = index;
      return;
    }
    indexRef.current = index;
    for (const listener of listeners) listener();
  }, [index, linkable, listeners, projects]);

  const extensions = useMemo(
    () =>
      noteLinkExtensions({
        getNotes: () => indexRef.current.notes,
        getProjects: () => indexRef.current.projects,
        getHeadings: (projectId) =>
          caches.headings.get(projectId, notesRef.current.find((note) => note.id === projectId)?.updatedAt ?? 0),
        getBlocks: (projectId) => {
          const open = openNoteEditor(projectId)?.editor;
          if (open && !open.isDestroyed) return docBlockChoices(open.state.doc);
          return caches.blocks.get(projectId, notesRef.current.find((note) => note.id === projectId)?.updatedAt ?? 0);
        },
        assignBlockId: (projectId, block) =>
          assignNoteBlockId(block, {
            editor: () => {
              const open = openNoteEditor(projectId)?.editor;
              return open && !open.isDestroyed ? open.view : null;
            },
            load: () => loadRef.current(projectId),
            save: (text, version) => saveRef.current(projectId, text, version),
          }).catch((error: unknown) => {
            notifyError("add a block id", error, i18n.t(($) => $.notes.linksSearch.blocks.assignFailed));
            return null;
          }),
        onOpenNote: (noteId, options) => handlersRef.current.onOpenNote(noteId, options),
        onOpenProject: (projectId, options) => handlersRef.current.onOpenProject(projectId, options),
        currentProjectId: current,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        createNote: canCreate
          ? linkedNoteCreator(
              (title) => createRef.current?.({ title }) ?? Promise.reject(new Error("This window can't create notes.")),
              (projectId) => loadRef.current(projectId),
            )
          : undefined,
      }),
    [caches, canCreate, current, listeners],
  );

  return { extensions, index };
}
