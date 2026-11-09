import type { AnyExtension } from "@tiptap/core";
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { logError } from "@/lib/log";
import type { NoteLinkRecord } from "@/lib/tauri";
import { isLinkableId, noteHeadings, targetKey, type NoteHeading } from "./note-link-format";
import {
  noteLinkExtensions,
  type LinkableNote,
  type LinkableProject,
  type OpenNoteHandler,
  type OpenProjectHandler,
} from "./note-links";
import { useNotesData } from "./notes-data";
import { useProjectColor, type ProjectColorOf } from "./project-color";
import type { NoteItem } from "./types";
import { useVaultKey, vaultLoad } from "./vault-loads";

export interface Backlink {
  projectId: string;
  noteId: string | null;
  title: string;
  snippet: string;
  color?: string;
  icon?: string;
}

export interface NoteLinkIndex {
  notes: readonly LinkableNote[] | null;
  projects: readonly LinkableProject[] | null;
  backlinks: ReadonlyMap<string, readonly Backlink[]>;
}

const NONE: readonly Backlink[] = [];

export function buildNoteLinkIndex(
  records: readonly NoteLinkRecord[] | null,
  notes: readonly NoteItem[],
  projects: readonly { id: string; name: string }[] | undefined,
  colorOf: ProjectColorOf,
): NoteLinkIndex {
  const items = new Map(notes.map((note) => [note.id, note]));
  const byProject = new Map((records ?? []).map((record) => [record.projectId, record]));
  const linkable = records
    ? notes.flatMap((note): LinkableNote[] => {
        const noteId = byProject.get(note.id)?.noteId;
        if (!isLinkableId(noteId)) return [];
        const linkable: LinkableNote = { noteId, projectId: note.id, title: note.title, color: note.color, icon: note.icon };
        const aliases = (note as NoteItem & { aliases?: readonly string[] }).aliases;
        if (aliases && aliases.length > 0) linkable.aliases = aliases;
        return [linkable];
      })
    : null;
  const backlinks = new Map<string, Backlink[]>();
  for (const record of records ?? []) {
    const source = items.get(record.projectId);
    if (!source) continue;
    for (const link of record.links) {
      if (link.kind === "note" && link.id === record.noteId) continue;
      const key = targetKey(link);
      const list = backlinks.get(key) ?? [];
      list.push({
        projectId: record.projectId,
        noteId: record.noteId,
        title: source.title,
        snippet: link.snippet,
        color: source.color,
        icon: source.icon,
      });
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

function sameAliases(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((alias, index) => alias === right[index]);
}

function sameLinkable(left: readonly LinkableNote[] | null, right: readonly LinkableNote[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((note, index) => {
    const other = right[index];
    return (
      note.noteId === other.noteId &&
      note.projectId === other.projectId &&
      note.title === other.title &&
      note.color === other.color &&
      note.icon === other.icon &&
      sameAliases(note.aliases, other.aliases)
    );
  });
}

function sameProjects(left: readonly LinkableProject[] | null, right: readonly LinkableProject[] | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((project, index) => {
    const other = right[index];
    return project.projectId === other.projectId && project.title === other.title && project.color === other.color;
  });
}

function sameBacklinkList(left: readonly Backlink[], right: readonly Backlink[]): boolean {
  return (
    left.length === right.length &&
    left.every((link, index) => {
      const other = right[index];
      return (
        link.projectId === other.projectId &&
        link.noteId === other.noteId &&
        link.title === other.title &&
        link.snippet === other.snippet &&
        link.color === other.color &&
        link.icon === other.icon
      );
    })
  );
}

function sameBacklinks(left: NoteLinkIndex["backlinks"], right: NoteLinkIndex["backlinks"]): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [key, list] of left) {
    const other = right.get(key);
    if (!other || !sameBacklinkList(list, other)) return false;
  }
  return true;
}

export function keepUnchanged(previous: NoteLinkIndex | null, next: NoteLinkIndex): NoteLinkIndex {
  if (!previous) return next;
  const notes = sameLinkable(previous.notes, next.notes) ? previous.notes : next.notes;
  const projects = sameProjects(previous.projects, next.projects) ? previous.projects : next.projects;
  const backlinks = sameBacklinks(previous.backlinks, next.backlinks) ? previous.backlinks : next.backlinks;
  if (notes === previous.notes && projects === previous.projects && backlinks === previous.backlinks) return previous;
  return { notes, projects, backlinks };
}

const EMPTY_INDEX: NoteLinkIndex = { notes: null, projects: null, backlinks: new Map() };
const SharedIndex = createContext<NoteLinkIndex | null>(null);

export function useNoteLinkRecords(enabled = true): readonly NoteLinkRecord[] | null {
  const { noteLinks } = useNotesData();
  const vault = useVaultKey();
  const [records, setRecords] = useState<readonly NoteLinkRecord[] | null>(null);

  useEffect(() => {
    if (!noteLinks || !enabled) return;
    let live = true;
    vaultLoad(noteLinks, vault).then(
      (loaded) => {
        if (live) setRecords(loaded);
      },
      (error: unknown) => void logError("read note links", error),
    );
    return () => {
      live = false;
    };
  }, [enabled, noteLinks, vault]);

  return records;
}

interface BuiltIndex {
  inputs: readonly unknown[];
  index: NoteLinkIndex;
}

const BUILT_KEPT = 4;
const built: BuiltIndex[] = [];

function sharedBuild(
  records: readonly NoteLinkRecord[] | null,
  notes: readonly NoteItem[],
  projects: readonly { id: string; name: string }[] | undefined,
  colorOf: ProjectColorOf,
): NoteLinkIndex {
  const inputs = [records, notes, projects, colorOf];
  const found = built.find((entry) => entry.inputs.every((input, index) => input === inputs[index]));
  if (found) return found.index;
  const index = buildNoteLinkIndex(records, notes, projects, colorOf);
  built.unshift({ inputs, index });
  if (built.length > BUILT_KEPT) built.pop();
  return index;
}

function useBuiltNoteLinkIndex(enabled: boolean): NoteLinkIndex {
  const { notes, projects } = useNotesData();
  const colorOf = useProjectColor();
  const records = useNoteLinkRecords(enabled);
  const previous = useRef<NoteLinkIndex | null>(null);
  return useMemo(() => {
    if (!enabled) return EMPTY_INDEX;
    const next = keepUnchanged(previous.current, sharedBuild(records, notes, projects, colorOf));
    previous.current = next;
    return next;
  }, [colorOf, enabled, notes, projects, records]);
}

export function NoteLinkIndexProvider({ children }: Readonly<{ children: ReactNode }>) {
  const index = useBuiltNoteLinkIndex(true);
  return createElement(SharedIndex.Provider, { value: index }, children);
}

export function FrozenNoteLinkIndex({ live, children }: Readonly<{ live: boolean; children: ReactNode }>) {
  const index = useContext(SharedIndex);
  const kept = useRef(index);
  if (live) kept.current = index;
  return index === null ? children : createElement(SharedIndex.Provider, { value: kept.current }, children);
}

export function useNoteLinkIndex(): NoteLinkIndex {
  const shared = useContext(SharedIndex);
  const own = useBuiltNoteLinkIndex(shared === null);
  return shared ?? own;
}

export function backlinksOf(index: NoteLinkIndex, noteId: string | null | undefined): readonly Backlink[] {
  return isLinkableId(noteId) ? (index.backlinks.get(targetKey({ kind: "note", id: noteId })) ?? NONE) : NONE;
}

export function useNoteBacklinks(noteId: string | null | undefined): readonly Backlink[] {
  return backlinksOf(useNoteLinkIndex(), noteId);
}

export interface NoteLinkHandlers {
  currentProjectId?: string | null;
  onOpenNote: OpenNoteHandler;
  onOpenProject: OpenProjectHandler;
}

interface CachedHeadings {
  updatedAt: number;
  headings: readonly NoteHeading[] | null;
}

export class HeadingCache {
  private readonly entries = new Map<string, CachedHeadings>();

  constructor(
    private readonly load: (projectId: string) => Promise<string>,
    private readonly changed: () => void,
  ) {}

  get(projectId: string, updatedAt: number): readonly NoteHeading[] | null {
    const cached = this.entries.get(projectId);
    if (cached?.updatedAt === updatedAt) return cached.headings;
    const entry: CachedHeadings = { updatedAt, headings: null };
    this.entries.set(projectId, entry);
    this.load(projectId).then(
      (text) => {
        if (this.entries.get(projectId) !== entry) return;
        entry.headings = noteHeadings(text);
        this.changed();
      },
      (error: unknown) => {
        if (this.entries.get(projectId) !== entry) return;
        entry.headings = [];
        void logError("read note headings", error);
        this.changed();
      },
    );
    return null;
  }
}

export function useNoteLinkExtensions(handlers: NoteLinkHandlers): { extensions: AnyExtension[]; index: NoteLinkIndex } {
  const index = useNoteLinkIndex();
  const { notes, loadNote } = useNotesData();
  const indexRef = useRef(index);
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const loadRef = useRef(loadNote);
  loadRef.current = loadNote;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [listeners] = useState(() => new Set<() => void>());
  const [headings] = useState(
    () =>
      new HeadingCache(
        (projectId) => loadRef.current(projectId).then((source) => source.text),
        () => {
          for (const listener of listeners) listener();
        },
      ),
  );
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
          headings.get(projectId, notesRef.current.find((note) => note.id === projectId)?.updatedAt ?? 0),
        onOpenNote: (noteId, options) => handlersRef.current.onOpenNote(noteId, options),
        onOpenProject: (projectId, options) => handlersRef.current.onOpenProject(projectId, options),
        currentProjectId: current,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      }),
    [current, headings, listeners],
  );

  return { extensions, index };
}
