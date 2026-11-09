// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteLinkRecord } from "@/lib/tauri";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { LinkableNote, NoteLinkOptions } from "./note-links";
import type { NoteItem } from "./types";
import { notesRevision, useNoteKnowledge, useVaultTags } from "./use-note-knowledge";
import { buildNoteLinkIndex, HeadingCache, useNoteLinkExtensions } from "./use-note-links";

const mocks = vi.hoisted(() => ({ listNoteTags: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  listNoteTags: mocks.listNoteTags,
}));

vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: mocks.logError,
}));

function item(id: string, title: string, extra: Partial<NoteItem> & { aliases?: string[] } = {}): NoteItem {
  return { id, title, project: "Notes", updatedAt: 5, author: "you", summary: "", ...extra };
}

const NOTES = [item("lib-1", "Masking", { preview: "Body", aliases: ["MAE"] }), item("lib-2", "Other")];
const LINKABLE: LinkableNote[] = [{ noteId: "n-1", projectId: "lib-1", title: "Masking" }];

function data(overrides: Partial<NotesData> = {}): NotesData {
  return {
    notes: NOTES,
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn((id: string) => Promise.resolve({ text: `# Head of ${id}\n`, version: "v" })),
    saveNote: vi.fn(),
    ...overrides,
  };
}

function wrapperFor(value: { current: NotesData }) {
  return ({ children }: { children: ReactNode }) => <NotesDataProvider value={value.current}>{children}</NotesDataProvider>;
}

beforeEach(() => {
  mocks.listNoteTags.mockReset();
  mocks.logError.mockReset();
});

describe("vault tags", () => {
  it("reads tag labels and refreshes when notes change", async () => {
    mocks.listNoteTags.mockResolvedValue([
      { tag: "ml", label: "ML", count: 2, notes: [] },
      { tag: "raw", label: "", count: 1, notes: [] },
    ]);
    const value = { current: data() };
    const { result, rerender } = renderHook(() => useVaultTags(), { wrapper: wrapperFor(value) });
    await waitFor(() => expect(result.current).toEqual(["ML", "raw"]));
    value.current = data({ notes: [...NOTES, item("lib-3", "New", { updatedAt: 9 })] });
    rerender();
    await waitFor(() => expect(mocks.listNoteTags).toHaveBeenCalledTimes(2));
    expect(notesRevision([{ updatedAt: 2 }, { updatedAt: 1 }])).toBe(2002);
  });

  it("falls back to no tags outside the desktop app", async () => {
    mocks.listNoteTags.mockRejectedValue(new Error("no ipc"));
    const { result, unmount } = renderHook(() => useVaultTags(), { wrapper: wrapperFor({ current: data() }) });
    await waitFor(() => expect(mocks.listNoteTags).toHaveBeenCalled());
    expect(result.current).toEqual([]);
    unmount();
  });
});

describe("knowledge sources", () => {
  it("gives the editor live notes, previews, loads and handlers", async () => {
    mocks.listNoteTags.mockResolvedValue([{ tag: "ml", label: "ml", count: 1, notes: [] }]);
    const onOpenNote = vi.fn();
    const onOpenTag = vi.fn();
    const resolveAsset = vi.fn(() => Promise.resolve("blob:x"));
    const value = { current: data({ resolveAsset }) };
    const { result, rerender } = renderHook(
      (props: { notes: readonly LinkableNote[] | null }) =>
        useNoteKnowledge({ notes: props.notes, currentNoteId: "n-0", onOpenNote, onOpenTag }),
      { wrapper: wrapperFor(value), initialProps: { notes: null as readonly LinkableNote[] | null } },
    );
    const first = result.current;
    const listener = vi.fn();
    const stop = first.embeds.subscribe?.(listener);
    expect(first.embeds.getNotes()).toBeNull();
    rerender({ notes: LINKABLE });
    expect(result.current).toBe(first);
    expect(first.embeds.getNotes()).toBe(LINKABLE);
    expect(listener).toHaveBeenCalled();
    expect(first.embeds.currentNoteId()).toBe("n-0");
    expect(first.embeds.version("lib-1")).toBe(5);
    expect(first.embeds.version("missing")).toBe(0);
    await expect(first.embeds.loadText("lib-1")).resolves.toBe("# Head of lib-1\n");
    await expect(first.hover.resolveAsset?.("lib-1", "a.png")).resolves.toBe("blob:x");
    expect(first.hover.previewOf("lib-1")).toBe("Body");
    first.embeds.onOpen("n-1", { newTab: true, projectId: "lib-1" });
    expect(onOpenNote).toHaveBeenCalledWith("n-1", { newTab: true, projectId: "lib-1" });
    const tagOptions = (first.tagExtensions[0].options ?? {}) as { getTags(): readonly string[]; getOpenTag(): unknown };
    await waitFor(() => expect(tagOptions.getTags()).toEqual(["ml"]));
    expect(tagOptions.getOpenTag()).toBe(onOpenTag);
    stop?.();
    value.current = data({ resolveAsset: undefined });
    rerender({ notes: LINKABLE });
    await expect(first.hover.resolveAsset?.("lib-1", "a.png")).resolves.toBeNull();
  });
});

describe("heading lookups", () => {
  it("loads headings once per version and reports failures as no headings", async () => {
    const changed = vi.fn();
    const load = vi.fn((id: string) => (id === "bad" ? Promise.reject(new Error("io")) : Promise.resolve("# A\n## B\n")));
    const cache = new HeadingCache(load, changed);
    expect(cache.get("lib-1", 1)).toBeNull();
    expect(cache.get("lib-1", 1)).toBeNull();
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(cache.get("lib-1", 1)?.map((heading) => heading.slug)).toEqual(["a", "b"]);
    expect(cache.get("lib-1", 2)).toBeNull();
    expect(cache.get("bad", 1)).toBeNull();
    await waitFor(() => expect(cache.get("bad", 1)).toEqual([]));
    expect(mocks.logError).toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("drops a stale load when a newer version was asked for", async () => {
    let finish: (text: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const changed = vi.fn();
    const cache = new HeadingCache(load, changed);
    cache.get("x", 1);
    const first = finish;
    cache.get("x", 2);
    first("# Old\n");
    await act(async () => {
      await Promise.resolve();
    });
    expect(changed).not.toHaveBeenCalled();
    const failing = new HeadingCache(() => Promise.reject(new Error("late")), changed);
    failing.get("y", 1);
    failing.get("y", 2);
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("offers aliases and headings through the link extension", async () => {
    const records: NoteLinkRecord[] = [{ projectId: "lib-1", noteId: "n-1", title: "Masking", links: [] }];
    const index = buildNoteLinkIndex(records, NOTES, undefined, () => null);
    expect(index.notes?.[0].aliases).toEqual(["MAE"]);
    const value = { current: data({ noteLinks: () => Promise.resolve(records) }) };
    const { result } = renderHook(
      () => useNoteLinkExtensions({ currentProjectId: "lib-2", onOpenNote: vi.fn(), onOpenProject: vi.fn() }),
      { wrapper: wrapperFor(value) },
    );
    const options = result.current.extensions[0].options as NoteLinkOptions;
    expect(options.getHeadings?.("lib-1")).toBeNull();
    await waitFor(() => expect(options.getHeadings?.("lib-1")?.[0]?.text).toBe("Head of lib-1"));
    expect(options.getHeadings?.("unknown")).toBeNull();
  });
});

describe("knowledge refreshes", () => {
  it("leaves tag chips and embeds alone when a note changes in a way neither shows", async () => {
    mocks.listNoteTags.mockResolvedValue([{ tag: "ml", label: "ml", count: 1, notes: [] }]);
    const value = { current: data({ revision: 1, noteTags: mocks.listNoteTags }) };
    const input = { notes: LINKABLE, currentNoteId: "n-0", onOpenNote: vi.fn(), onOpenTag: vi.fn() };
    const { result, rerender } = renderHook(() => useNoteKnowledge(input), { wrapper: wrapperFor(value) });
    const tagOptions = (result.current.tagExtensions[0].options ?? {}) as { getTags(): readonly string[]; subscribe(listener: () => void): () => void };
    await waitFor(() => expect(tagOptions.getTags()).toEqual(["ml"]));
    const tagsChanged = vi.fn();
    const embedsChanged = vi.fn();
    tagOptions.subscribe(tagsChanged);
    result.current.embeds.subscribe?.(embedsChanged);

    value.current = data({ revision: 1, noteTags: mocks.listNoteTags, notes: NOTES.map((note) => ({ ...note, preview: "Typed more" })) });
    rerender();
    await act(async () => {});
    expect(tagsChanged).not.toHaveBeenCalled();
    expect(embedsChanged).not.toHaveBeenCalled();

    value.current = data({ revision: 1, noteTags: mocks.listNoteTags, notes: NOTES.map((note) => ({ ...note, updatedAt: 9 })) });
    rerender();
    expect(embedsChanged).toHaveBeenCalledTimes(1);
    expect(tagsChanged).not.toHaveBeenCalled();

    mocks.listNoteTags.mockResolvedValue([{ tag: "vision", label: "vision", count: 1, notes: [] }]);
    value.current = data({ revision: 2, noteTags: mocks.listNoteTags, notes: value.current.notes });
    rerender();
    await waitFor(() => expect(tagsChanged).toHaveBeenCalledTimes(1));
    expect(tagOptions.getTags()).toEqual(["vision"]);
  });
});
