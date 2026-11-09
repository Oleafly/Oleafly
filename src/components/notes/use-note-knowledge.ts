import type { AnyExtension } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listNoteTags } from "@/lib/tauri";
import type { EmbedOptions } from "./note-embeds";
import type { LinkableNote, OpenNoteOptions } from "./note-links";
import { noteTagExtensions } from "./note-tag-chips";
import { useNotesData } from "./notes-data";
import { vaultLoad } from "./vault-loads";

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
  embeds: EmbedOptions;
  hover: HoverSources;
}

export function notesRevision(notes: readonly { updatedAt: number }[]): number {
  return notes.reduce((latest, note) => Math.max(latest, note.updatedAt), 0) * 1000 + notes.length;
}

export function useVaultTags(): readonly string[] {
  const { notes, noteTags, revision: vault } = useNotesData();
  const fallback = useMemo(() => notesRevision(notes), [notes]);
  const revision = noteTags && vault !== undefined ? vault : fallback;
  const load = useMemo(() => (noteTags && vault !== undefined ? () => vaultLoad(noteTags, vault) : listNoteTags), [noteTags, vault]);
  const [tags, setTags] = useState<{ revision: number; tags: readonly string[] }>({ revision: -1, tags: [] });
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => load())
      .then(
        (found) => {
          if (live) setTags({ revision, tags: found.map((entry) => entry.label || entry.tag) });
        },
        () => {
          if (live) setTags({ revision, tags: [] });
        },
      );
    return () => {
      live = false;
    };
  }, [load, revision]);
  return tags.tags;
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
  const versions = useMemo(() => data.notes.map((note) => `${note.id}:${note.updatedAt}`).join("\n"), [data.notes]);
  const tagState = useMemo(() => ({ tags, opensTags }), [opensTags, tags]);
  const embedState = useMemo(
    () => ({ linkable: input.notes, currentNoteId: input.currentNoteId, versions }),
    [input.currentNoteId, input.notes, versions],
  );
  useNotify(tagListeners, tagState);
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
