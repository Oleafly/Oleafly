import type { AnyExtension } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteTagCount } from "@/lib/tauri";
import type { EmbedOptions } from "./note-embeds";
import type { LinkableNote, OpenNoteOptions } from "./note-links";
import { noteAtExtensions } from "./note-at";
import { noteTagExtensions } from "./note-tag-chips";
import { useNotesData, useVaultLoad } from "./notes-data";
import type { NoteItem } from "./types";

export interface NoteKnowledgeInput {
  notes: readonly LinkableNote[] | null;
  currentNoteId: string | null | undefined;
  onOpenNote: (noteId: string, options: OpenNoteOptions) => void;
  onOpenTag?: (tag: string) => void;
}

export interface HoverSources {
  getNotes: () => readonly LinkableNote[] | null;
  previewOf: (projectId: string) => string | undefined;
  loadText: (projectId: string) => Promise<string>;
  resolveAsset?: (projectId: string, path: string) => Promise<string | null>;
}

export interface NoteKnowledge {
  tagExtensions: AnyExtension[];
  atExtensions: AnyExtension[];
  embeds: EmbedOptions;
  hover: HoverSources;
}

const NO_TAGS: readonly NoteTagCount[] = [];

export function useVaultTags(): readonly string[] {
  const counts = useVaultLoad("tags", useNotesData().noteTags).data ?? NO_TAGS;
  return useMemo(() => counts.map((entry) => entry.label || entry.tag), [counts]);
}

function useListeners(): readonly [Set<() => void>, (listener: () => void) => () => void] {
  const [listeners] = useState(() => new Set<() => void>());
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [listeners],
  );
  return [listeners, subscribe];
}

function useVersionCount(notes: readonly NoteItem[]): number {
  const seen = useRef({ notes, count: 0, versions: new Map(notes.map((note) => [note.id, note.updatedAt])) });
  const last = seen.current;
  if (last.notes !== notes) {
    const changed = notes.length !== last.versions.size || notes.some((note) => last.versions.get(note.id) !== note.updatedAt);
    seen.current = changed
      ? { notes, count: last.count + 1, versions: new Map(notes.map((note) => [note.id, note.updatedAt])) }
      : { ...last, notes };
  }
  return seen.current.count;
}

function useNotify(listeners: Set<() => void>, state: unknown): void {
  useEffect(() => {
    if (state === undefined) return;
    for (const listener of listeners) listener();
  }, [listeners, state]);
}

export function useNoteKnowledge(input: NoteKnowledgeInput): NoteKnowledge {
  const data = useNotesData();
  const tags = useVaultTags();
  const latest = useRef({ input, data, tags });
  latest.current = { input, data, tags };
  const [tagListeners, subscribeTags] = useListeners();
  const [embedListeners, subscribeEmbeds] = useListeners();

  const opensTags = Boolean(input.onOpenTag);
  const versions = useVersionCount(data.notes);
  const embedState = useMemo(
    () => ({ linkable: input.notes, currentNoteId: input.currentNoteId, versions }),
    [input.currentNoteId, input.notes, versions],
  );
  useNotify(tagListeners, opensTags);
  useNotify(embedListeners, embedState);

  return useMemo(() => {
    const getNotes = () => latest.current.input.notes;
    const loadText = (projectId: string) => latest.current.data.loadNote(projectId).then((source) => source.text);
    const resolveAsset = (projectId: string, path: string) =>
      latest.current.data.resolveAsset?.(projectId, path) ?? Promise.resolve(null);
    const noteOf = (projectId: string) => latest.current.data.notes.find((note) => note.id === projectId);
    return {
      tagExtensions: noteTagExtensions({
        getTags: () => latest.current.tags,
        getOpenTag: () => latest.current.input.onOpenTag,
        subscribe: subscribeTags,
      }),
      atExtensions: noteAtExtensions({
        getTags: () => latest.current.tags,
        getNotes,
        getCurrentNoteId: () => latest.current.input.currentNoteId,
        subscribe: subscribeTags,
      }),
      embeds: {
        getNotes,
        currentNoteId: () => latest.current.input.currentNoteId,
        loadText,
        version: (projectId) => noteOf(projectId)?.updatedAt ?? 0,
        resolveAsset,
        onOpen: (noteId, options) => latest.current.input.onOpenNote(noteId, options),
        subscribe: subscribeEmbeds,
      },
      hover: {
        getNotes,
        previewOf: (projectId) => noteOf(projectId)?.preview,
        loadText,
        resolveAsset,
      },
    };
  }, [subscribeEmbeds, subscribeTags]);
}
