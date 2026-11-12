import { keptViews, promoteShown } from "@oleafly/workspace/retention";
import { useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { noteEditorBusy } from "@/lib/open-note-editors";
import { isEditorNoteFile, projectNoteKey } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import { editsAsMarkdown, noteTabsFor, useNoteTabsStore } from "@/store/note-tabs";

export const KEPT_HIDDEN_NOTE_TABS = 3;

export type NoteTabView =
  | { key: string; kind: "personal"; projectId: string; noteId: string }
  | { key: string; kind: "file"; projectId: string; path: string };

export interface KeptNoteTab {
  view: NoteTabView;
  shown: boolean;
}

const NONE: readonly string[] = [];

export function personalNoteView(projectId: string, noteId: string): NoteTabView {
  return { key: `personal\u0000${projectId}\u0000${noteId}`, kind: "personal", projectId, noteId };
}

export function fileNoteView(projectId: string, path: string): NoteTabView {
  return { key: `file\u0000${projectId}\u0000${path}`, kind: "file", projectId, path };
}

function editorNoteId(view: NoteTabView): string {
  return view.kind === "personal" ? view.noteId : projectNoteKey(view.projectId, view.path);
}

export function useKeptNoteTabs(shown: NoteTabView | null, projectId: string | null, notesOn: boolean): KeptNoteTab[] {
  const [recent, setRecent] = useState<readonly string[]>(NONE);
  const views = useRef(new Map<string, NoteTabView>());
  if (shown) views.current.set(shown.key, shown);
  const candidates = recent.flatMap((key) => {
    const view = views.current.get(key);
    return view?.kind === "file" ? [view.path] : [];
  });
  const personal = useNoteTabsStore(
    useShallow((state) => (notesOn ? noteTabsFor(state, projectId).map((tab) => tab.id) : NONE)),
  );
  const asMarkdown = useNoteTabsStore(
    useShallow((state) => candidates.filter((path) => editsAsMarkdown(state, projectId, path))),
  );
  const files = useFilesStore(
    useShallow((state) =>
      candidates.filter(
        (path) =>
          state.projectId === projectId &&
          state.openTabs.includes(path) &&
          isEditorNoteFile(path, state.files[path]?.content, { notes: notesOn, projectKind: state.projectKind }),
      ),
    ),
  );
  const open = (view: NoteTabView): boolean => {
    if (!notesOn || view.projectId !== projectId) return false;
    if (view.kind === "personal") return personal.includes(view.noteId);
    return files.includes(view.path) && !asMarkdown.includes(view.path);
  };
  const known: Record<string, NoteTabView> = {};
  for (const key of recent) {
    const view = views.current.get(key);
    if (view && open(view)) known[key] = view;
  }
  if (shown) known[shown.key] = shown;
  const shownKeys = shown ? [shown.key] : NONE;
  const promoted = promoteShown(recent, shownKeys, known);
  const kept = keptViews(promoted, new Set(shownKeys), KEPT_HIDDEN_NOTE_TABS, (key) => !noteEditorBusy(editorNoteId(known[key])));
  const mounted = promoted.filter((key) => kept.has(key));
  if (mounted.length !== recent.length || mounted.some((key, index) => key !== recent[index])) setRecent(mounted);
  for (const key of views.current.keys()) {
    if (!mounted.includes(key)) views.current.delete(key);
  }
  return mounted.map((key) => ({ view: known[key], shown: key === shown?.key }));
}
