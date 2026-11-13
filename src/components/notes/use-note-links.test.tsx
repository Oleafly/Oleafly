// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteLinkRecord } from "@/lib/tauri";
import { useProjectColorsStore } from "@/store/project-colors";
import { NotesDataProvider, type NotesData, VAULT_QUERY } from "./notes-data";
import type { NoteLinkOptions } from "./note-links";
import { fakeNotesData } from "./tests/notes-data-fixture";
import type { NoteItem } from "./types";
import {
  buildNoteLinkIndex,
  FrozenNoteLinkIndex,
  keepUnchanged,
  NoteLinkIndexProvider,
  useNoteBacklinks,
  useNoteLinkExtensions,
  useNoteLinkIndex,
} from "./use-note-links";

const mocks = vi.hoisted(() => ({ logError: vi.fn() }));

vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));

function item(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", ...extra };
}

const NOTES: NoteItem[] = [
  item("lib-1", "Masking report", { color: "rose", icon: "🧪" }),
  item("lib-2", "Abstract draft"),
  item("lib-3", "Reading notes"),
  item("lib-4", "No id yet"),
];

const RECORDS: NoteLinkRecord[] = [
  { projectId: "lib-1", noteId: "n-1", title: "Masking report", links: [{ kind: "note", id: "n-1", snippet: "Self" }] },
  {
    projectId: "lib-3",
    noteId: "n-3",
    title: "Reading notes",
    links: [
      { kind: "note", id: "n-1", snippet: "See the report" },
      { kind: "project", id: "ssl", snippet: "In SSL" },
    ],
  },
  { projectId: "lib-2", noteId: "n-2", title: "Abstract draft", links: [{ kind: "note", id: "n-1", snippet: "Also the report" }] },
  { projectId: "lib-4", noteId: "not linkable", title: "No id yet", links: [] },
  { projectId: "gone", noteId: "n-9", title: "Deleted", links: [{ kind: "note", id: "n-1", snippet: "Old" }] },
];

const PROJECTS = [
  { id: "ssl", name: "SSL masking" },
  { id: "thesis", name: "Thesis" },
];

function data(overrides: Partial<NotesData> = {}): NotesData {
  return fakeNotesData({ notes: NOTES, projects: PROJECTS, ...overrides });
}

function wrapperFor(value: { current: NotesData }, live?: { current: boolean }) {
  return ({ children }: { children: ReactNode }) => (
    <NotesDataProvider value={value.current}>
      <NoteLinkIndexProvider>
        {live ? <FrozenNoteLinkIndex live={live.current}>{children}</FrozenNoteLinkIndex> : children}
      </NoteLinkIndexProvider>
    </NotesDataProvider>
  );
}

beforeEach(() => {
  mocks.logError.mockReset();
  useProjectColorsStore.setState({ colors: { ssl: "#ff0000" } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the link index", () => {
  it("knows nothing until the links load", () => {
    const index = buildNoteLinkIndex(null, NOTES, undefined, () => null);
    expect(index.notes).toBeNull();
    expect(index.projects).toBeNull();
    expect(index.backlinks.size).toBe(0);
  });

  it("lists linkable notes in library order and reverses links into backlinks", () => {
    const index = buildNoteLinkIndex(RECORDS, NOTES, PROJECTS, (id) => (id === "ssl" ? "#ff0000" : null));
    expect(index.notes).toEqual([
      { noteId: "n-1", projectId: "lib-1", title: "Masking report", color: "rose", icon: "🧪" },
      { noteId: "n-2", projectId: "lib-2", title: "Abstract draft", color: undefined, icon: undefined },
      { noteId: "n-3", projectId: "lib-3", title: "Reading notes", color: undefined, icon: undefined },
    ]);
    expect(index.projects).toEqual([
      { projectId: "ssl", title: "SSL masking", color: "#ff0000" },
      { projectId: "thesis", title: "Thesis", color: null },
    ]);
    expect(index.backlinks.get("note:n-1")?.map((link) => [link.title, link.snippet])).toEqual([
      ["Abstract draft", "Also the report"],
      ["Reading notes", "See the report"],
    ]);
    expect(index.backlinks.get("project:ssl")).toEqual([
      { projectId: "lib-3", noteId: "n-3", title: "Reading notes", snippet: "In SSL", color: undefined, icon: undefined },
    ]);
  });
});

describe("useNoteLinkIndex", () => {
  it("loads the links once for every hook that shares a notes list and again when the list changes", async () => {
    const noteLinks = vi.fn(() => Promise.resolve(RECORDS));
    const value = { current: data({ noteLinks }) };
    const { result, rerender } = renderHook(
      () => ({ index: useNoteLinkIndex(), again: useNoteLinkIndex(), backlinks: useNoteBacklinks("n-1") }),
      { wrapper: wrapperFor(value) },
    );
    expect(result.current.index.notes).toBeNull();
    await waitFor(() => expect(result.current.index.notes).toHaveLength(3));
    expect(result.current.again).toBe(result.current.index);
    expect(result.current.backlinks.map((link) => link.projectId)).toEqual(["lib-2", "lib-3"]);
    expect(result.current.index.backlinks.get("project:ssl")?.map((link) => link.projectId)).toEqual(["lib-3"]);
    expect(result.current.index.projects?.[0].color).toBe("#ff0000");
    expect(noteLinks).toHaveBeenCalledTimes(1);

    value.current = data({ noteLinks, notes: NOTES.slice(0, 2) });
    rerender();
    await waitFor(() => expect(result.current.index.notes).toHaveLength(2));
    expect(noteLinks).toHaveBeenCalledTimes(2);
  });

  it("returns no backlinks for a note without a usable id", async () => {
    const noteLinks = vi.fn(() => Promise.resolve(RECORDS));
    const { result } = renderHook(() => [useNoteBacklinks(undefined), useNoteBacklinks("a b"), useNoteBacklinks(null)], {
      wrapper: wrapperFor({ current: data({ noteLinks }) }),
    });
    await waitFor(() => expect(noteLinks).toHaveBeenCalled());
    expect(result.current.every((list) => list.length === 0)).toBe(true);
  });

  it("stays empty without a provider or an adapter, and logs a failed load", async () => {
    const outside = renderHook(() => useNoteLinkIndex());
    expect(outside.result.current.notes).toBeNull();
    const none = renderHook(() => useNoteLinkIndex(), { wrapper: wrapperFor({ current: data() }) });
    expect(none.result.current.notes).toBeNull();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    const failing = vi.fn(() => Promise.reject(new Error("no disk")));
    const failed = renderHook(() => useNoteLinkIndex(), { wrapper: wrapperFor({ current: data({ noteLinks: failing }) }) });
    await act(() => vi.advanceTimersByTimeAsync(VAULT_QUERY.retryDelay));
    await waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("query", expect.any(Error)));
    expect(failed.result.current.notes).toBeNull();
  });

  it("reads only the notes a save changed and patches their links into the last list", async () => {
    const noteLinks = vi.fn((ids?: readonly string[]) =>
      Promise.resolve(
        ids
          ? [{ projectId: "lib-2", noteId: "n-2", title: "Abstract draft", links: [] }, ...RECORDS.filter((record) => record.projectId !== "lib-2")]
          : RECORDS,
      ),
    );
    const value = { current: data({ noteLinks, revision: 40 }) };
    const { result, rerender } = renderHook(() => useNoteBacklinks("n-1"), { wrapper: wrapperFor(value) });
    await waitFor(() => expect(result.current.map((link) => link.projectId)).toEqual(["lib-2", "lib-3"]));
    value.current = data({ noteLinks, revision: 41, changedNotes: ["lib-2"] });
    rerender();
    await waitFor(() => expect(result.current.map((link) => link.projectId)).toEqual(["lib-3"]));
    expect(noteLinks.mock.calls).toEqual([[], [["lib-2"]]]);
  });
});

describe("useNoteLinkExtensions", () => {
  it("keeps one extension set, reads the latest index and handlers and tells the editor when the index changes", async () => {
    const noteLinks = vi.fn(() => Promise.resolve(RECORDS));
    const value = { current: data({ noteLinks }) };
    const first = { onOpenNote: vi.fn(), onOpenProject: vi.fn() };
    const { result, rerender } = renderHook((handlers: typeof first) => useNoteLinkExtensions({ ...handlers, currentProjectId: "lib-1" }), {
      initialProps: first,
      wrapper: wrapperFor(value),
    });
    const extensions = result.current.extensions;
    expect(extensions).toHaveLength(1);
    const options = extensions[0].options as NoteLinkOptions;
    expect(options.currentProjectId).toBe("lib-1");
    expect(options.getNotes()).toBeNull();
    const listener = vi.fn();
    const stop = options.subscribe?.(listener);

    await waitFor(() => expect(options.getNotes()).toHaveLength(3));
    expect(listener).toHaveBeenCalled();
    expect(options.getProjects()).toHaveLength(2);

    const second = { onOpenNote: vi.fn(), onOpenProject: vi.fn() };
    rerender(second);
    expect(result.current.extensions).toBe(extensions);
    options.onOpenNote("n-1", { newTab: true, projectId: "lib-1" });
    options.onOpenProject("ssl", { newTab: false });
    expect(second.onOpenNote).toHaveBeenCalledWith("n-1", { newTab: true, projectId: "lib-1" });
    expect(second.onOpenProject).toHaveBeenCalledWith("ssl", { newTab: false });
    expect(first.onOpenNote).not.toHaveBeenCalled();

    stop?.();
    listener.mockClear();
    value.current = data({ noteLinks, notes: NOTES.slice(0, 1) });
    rerender(second);
    await waitFor(() => expect(options.getNotes()).toHaveLength(1));
    expect(listener).not.toHaveBeenCalled();
  });

  it("treats a missing current note as none", () => {
    const { result } = renderHook(() => useNoteLinkExtensions({ onOpenNote: vi.fn(), onOpenProject: vi.fn() }), {
      wrapper: wrapperFor({ current: data() }),
    });
    expect((result.current.extensions[0].options as NoteLinkOptions).currentProjectId).toBeNull();
  });
});

describe("the shared link index", () => {
  it("keeps the same index when a note changes in a way links do not see", async () => {
    const noteLinks = vi.fn(() => Promise.resolve(RECORDS));
    const value = { current: data({ noteLinks }) };
    const { result, rerender } = renderHook(() => useNoteLinkIndex(), { wrapper: wrapperFor(value) });
    await waitFor(() => expect(result.current.notes).toHaveLength(3));
    const first = result.current;
    value.current = data({ noteLinks, notes: NOTES.map((note) => ({ ...note, preview: "Edited body" })) });
    rerender();
    expect(result.current).toBe(first);
    value.current = data({ noteLinks, notes: NOTES.map((note) => (note.id === "lib-2" ? { ...note, title: "Renamed" } : note)) });
    rerender();
    expect(result.current.notes?.find((note) => note.projectId === "lib-2")?.title).toBe("Renamed");
    expect(result.current.backlinks.get("note:n-1")?.map((link) => link.title)).toContain("Renamed");
  });

  it("holds the last index for a hidden editor and catches up when it shows again", async () => {
    const noteLinks = vi.fn(() => Promise.resolve(RECORDS));
    const value = { current: data({ noteLinks }) };
    const live = { current: true };
    const { result, rerender } = renderHook(() => useNoteLinkIndex(), { wrapper: wrapperFor(value, live) });
    await waitFor(() => expect(result.current.notes).toHaveLength(3));
    live.current = false;
    value.current = data({ noteLinks, notes: NOTES.slice(0, 1) });
    rerender();
    await act(async () => {});
    expect(result.current.notes).toHaveLength(3);
    live.current = true;
    rerender();
    expect(result.current.notes).toHaveLength(1);
  });

  it("only tells editors about a change to linkable titles, icons, colours or aliases", async () => {
    const noteLinks = vi.fn(() => Promise.resolve(RECORDS));
    const value = { current: data({ noteLinks }) };
    const { result, rerender } = renderHook(
      () => useNoteLinkExtensions({ onOpenNote: vi.fn(), onOpenProject: vi.fn(), currentProjectId: "lib-1" }),
      { wrapper: wrapperFor(value) },
    );
    const options = result.current.extensions[0].options as NoteLinkOptions;
    await waitFor(() => expect(options.getNotes()).toHaveLength(3));
    const listener = vi.fn();
    options.subscribe?.(listener);
    value.current = data({ noteLinks, notes: NOTES.map((note) => ({ ...note, preview: "Typed more" })) });
    rerender();
    expect(listener).not.toHaveBeenCalled();
    value.current = data({ noteLinks, notes: NOTES.map((note) => (note.id === "lib-3" ? { ...note, aliases: ["Reading"] } : note)) });
    rerender();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("keepUnchanged", () => {
  it("reuses each part that did not change", () => {
    const first = buildNoteLinkIndex(RECORDS, NOTES, PROJECTS, () => null);
    expect(keepUnchanged(first, buildNoteLinkIndex(RECORDS, NOTES, PROJECTS, () => null))).toBe(first);
    expect(keepUnchanged(null, first)).toBe(first);
    const recoloured = keepUnchanged(first, buildNoteLinkIndex(RECORDS, NOTES, PROJECTS, () => "#00ff00"));
    expect(recoloured.notes).toBe(first.notes);
    expect(recoloured.backlinks).toBe(first.backlinks);
    expect(recoloured.projects).not.toBe(first.projects);
    const moved = keepUnchanged(first, buildNoteLinkIndex(RECORDS.slice(0, 2), NOTES, PROJECTS, () => null));
    expect(moved.backlinks).not.toBe(first.backlinks);
  });
});
