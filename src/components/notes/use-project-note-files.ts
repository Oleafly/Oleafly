import type { FileEntry } from "@oleafly/backend-port";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { logError } from "@/lib/log";
import { foldPath, isProjectNotePath, noteFileFacts, noteFileStem } from "@/lib/project-notes";
import { readFileContent } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { frontMatterBody } from "@/lib/front-matter";
import { isNoteColor, noteSummary } from "./note-file";
import type { NoteColor } from "./types";

export const PROJECT_NOTE_READ_LIMIT = 200;
const FOLDER_CHANGED_EVENT = "project-folder-changed";
const NOTES_FOLDER = /(?:^|[\\/])notes[\\/]/iu;
const NO_PATHS: readonly string[] = [];

export interface ProjectNoteFile {
  path: string;
  title: string;
  icon?: string;
  color?: NoteColor;
  summary: string;
}

const NOTE_PATHS = new WeakMap<readonly FileEntry[], readonly string[]>();

export function projectNotePaths(tree: readonly FileEntry[]): readonly string[] {
  const cached = NOTE_PATHS.get(tree);
  if (cached) return cached;
  const paths = tree.filter((entry) => !entry.is_dir && isProjectNotePath(entry.path)).map((entry) => entry.path);
  NOTE_PATHS.set(tree, paths);
  return paths;
}

interface FolderChange {
  projectId: string;
  paths: string[];
  rescan: boolean;
}

export function projectNoteFile(path: string, text: string | undefined): ProjectNoteFile | null {
  const facts = noteFileFacts(text);
  if (!facts || text === undefined) return null;
  return {
    path,
    title: facts.title ?? noteFileStem(path),
    ...(facts.icon ? { icon: facts.icon } : {}),
    ...(facts.color && isNoteColor(facts.color) ? { color: facts.color } : {}),
    summary: noteSummary(frontMatterBody(text)),
  };
}

export function touchesNotes(change: FolderChange, projectId: string): boolean {
  return change.projectId === projectId && (change.rescan || change.paths.some((path) => NOTES_FOLDER.test(path)));
}

export function changedNotePaths(change: FolderChange, paths: readonly string[]): ReadonlySet<string> | "all" {
  if (change.rescan) return "all";
  const known = new Map(paths.map((path) => [foldPath(path), path]));
  const changed = new Set<string>();
  for (const raw of change.paths) {
    const relative = foldPath(raw.replaceAll("\\", "/"));
    for (const [folded, path] of known) {
      if (relative === folded || relative.endsWith(`/${folded}`)) changed.add(path);
    }
  }
  return changed;
}

interface ReadNotes {
  projectId: string | null;
  texts: ReadonlyMap<string, string>;
}

interface CachedRow {
  text: string;
  row: ProjectNoteFile | null;
}

export function useProjectNoteFiles(projectId: string | null): {
  notes: ProjectNoteFile[];
  loaded: boolean;
  more: number;
} {
  const paths = useFilesStore(
    useShallow((state) =>
      state.projectId === projectId && projectId !== null ? projectNotePaths(state.tree) : NO_PATHS,
    ),
  );
  const open = useFilesStore(
    useShallow((state) => {
      const held: Record<string, string> = {};
      if (state.projectId !== projectId) return held;
      for (const path of paths) {
        const file = state.files[path];
        if (file) held[path] = file.content;
      }
      return held;
    }),
  );
  const wanted = useMemo(() => paths.slice(0, PROJECT_NOTE_READ_LIMIT), [paths]);
  const [read, setRead] = useState<ReadNotes>({ projectId: null, texts: new Map() });
  const [stale, setStale] = useState<ReadonlySet<string> | "all">(new Set());
  const readRef = useRef(read);
  readRef.current = read;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!projectId) return;
    const known = readRef.current.projectId === projectId ? readRef.current.texts : new Map<string, string>();
    const needed = wanted.filter(
      (path) =>
        openRef.current[path] === undefined && (stale === "all" || stale.has(path) || !known.has(path)),
    );
    if (needed.length === 0) return;
    let live = true;
    Promise.all(
      needed.map((path) =>
        readFileContent(projectId, path).then(
          (text) => [path, text] as const,
          () => [path, ""] as const,
        ),
      ),
    )
      .then((entries) => {
        if (!live) return;
        setRead((current) => {
          const texts = new Map(current.projectId === projectId ? current.texts : []);
          for (const [path, text] of entries) texts.set(path, text);
          const keep = new Set(wanted);
          for (const path of texts.keys()) if (!keep.has(path)) texts.delete(path);
          return { projectId, texts };
        });
        setStale((current) => (current === "all" || current.size > 0 ? new Set() : current));
      })
      .catch((error: unknown) => logError("read the project notes", error));
    return () => {
      live = false;
    };
  }, [projectId, stale, wanted]);

  const pathsRef = useRef(wanted);
  pathsRef.current = wanted;
  const onFolderChanged = useCallback(
    (change: FolderChange) => {
      if (!projectId || !touchesNotes(change, projectId)) return;
      const changed = changedNotePaths(change, pathsRef.current);
      if (changed !== "all" && changed.size === 0) return;
      setStale((current) => {
        if (current === "all" || changed === "all") return "all";
        return new Set([...current, ...changed]);
      });
    },
    [projectId],
  );
  useTauriEvent<FolderChange>(FOLDER_CHANGED_EVENT, onFolderChanged, projectId !== null && isTauri());

  const texts = read.projectId === projectId ? read.texts : null;
  const loaded = wanted.every((path) => open[path] !== undefined || texts?.has(path));
  const rows = useRef(new Map<string, CachedRow>());
  const notes = useMemo(() => {
    const next = new Map<string, CachedRow>();
    const found: ProjectNoteFile[] = [];
    for (const path of wanted) {
      const text = open[path] ?? texts?.get(path);
      if (text === undefined) continue;
      const cached = rows.current.get(path);
      const row = cached?.text === text ? cached.row : projectNoteFile(path, text);
      next.set(path, { text, row });
      if (row) found.push(row);
    }
    rows.current = next;
    return found.sort((left, right) => left.title.localeCompare(right.title) || left.path.localeCompare(right.path));
  }, [open, texts, wanted]);
  return { notes, loaded, more: Math.max(0, paths.length - wanted.length) };
}
