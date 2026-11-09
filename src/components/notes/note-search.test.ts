// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ logError: vi.fn(async () => {}) }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logError: log.logError,
}));

import { analyze } from "@oleafly/search-query";
import { i18n, loadNamespace } from "@/i18n";
import type { NoteSearchHit, NoteTagCount } from "@/lib/tauri";
import { buildNoteSearchSchema, vaultPlan } from "./note-query";
import {
  fold,
  hasExactTitle,
  highlightParts,
  linkFirstMention,
  phraseQuery,
  SEARCH_DEBOUNCE_MS,
  switcherMatches,
  tagTree,
  useNoteTagCounts,
  useVaultSearch,
} from "./note-search";
import { NotesDataProvider, type NotesData } from "./notes-data";
import type { NoteItem } from "./types";

function note(id: string, title: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title, project: "Notes", updatedAt: 0, author: "you", summary: "", ...extra };
}

function hit(id: string, title = id, score = 1): NoteSearchHit {
  return {
    id,
    noteId: null,
    title,
    titleRanges: [],
    score,
    snippets: [],
    tags: [],
    aliases: [],
    relatedProject: null,
    updatedAt: 0,
  };
}

function data(overrides: Partial<NotesData>): NotesData {
  return {
    notes: [],
    artifacts: [],
    experiments: [],
    citations: [],
    papers: [],
    loadNote: vi.fn(),
    saveNote: vi.fn(),
    ...overrides,
  };
}

function wrapperFor(value: { current: NotesData }) {
  return ({ children }: { children: ReactNode }) => createElement(NotesDataProvider, { value: value.current, children });
}

afterEach(() => {
  vi.useRealTimers();
  log.logError.mockClear();
});

describe("query helpers", () => {
  it("builds exact phrases", () => {
    expect(phraseQuery(' The "big"   plan ')).toBe('"The big plan"');
    expect(phraseQuery(' " ')).toBe("");
  });

  it("cuts text into highlighted and plain parts", () => {
    expect(highlightParts("masking ablation", [[8, 16], [0, 7]])).toEqual([
      { text: "masking", start: 0, match: true },
      { text: " ", start: 7, match: false },
      { text: "ablation", start: 8, match: true },
    ]);
    expect(highlightParts("abcdef", [[1, 4], [2, 5], [5, 5], [-3, 0], [4, 99]])).toEqual([
      { text: "a", start: 0, match: false },
      { text: "bcd", start: 1, match: true },
      { text: "e", start: 4, match: true },
      { text: "f", start: 5, match: true },
    ]);
    expect(highlightParts("", [])).toEqual([{ text: "", start: 0, match: false }]);
    expect(highlightParts("abc", [[0, 3]])).toEqual([{ text: "abc", start: 0, match: true }]);
  });

  it("folds case and accents", () => {
    expect(fold("Été Café")).toBe("ete cafe");
  });
});

describe("tag tree", () => {
  const tags: NoteTagCount[] = [
    { tag: "ml", label: "ML", count: 1, notes: ["a"] },
    { tag: "ml/vision", label: "ML/Vision", count: 2, notes: ["a", "b"] },
    { tag: "ml/nlp/bert", label: "ml/NLP/Bert", count: 1, notes: ["c"] },
    { tag: "draft", label: "draft", count: 1, notes: ["b"] },
    { tag: "mlops", label: "mlops", count: 1, notes: ["d"] },
  ];

  it("nests tags by slash and counts each note once per branch", () => {
    const tree = tagTree(tags);
    expect(tree.map((node) => [node.tag, node.name, node.count])).toEqual([
      ["draft", "draft", 1],
      ["ml", "ML", 3],
      ["mlops", "mlops", 1],
    ]);
    const ml = tree[1];
    expect(ml.children.map((node) => [node.tag, node.name, node.count])).toEqual([
      ["ml/nlp", "NLP", 1],
      ["ml/vision", "Vision", 2],
    ]);
    expect(ml.children[0].children.map((node) => node.name)).toEqual(["Bert"]);
  });

  it("names a branch by its key when the label has fewer parts", () => {
    expect(tagTree([{ tag: "a/b", label: "A", count: 1, notes: ["x"] }])[0].children[0].name).toBe("b");
  });
});

describe("switcher matches", () => {
  const notes = [
    note("a", "Masking ablation", { updatedAt: 10 }),
    note("b", "Reading list", { updatedAt: 30, aliases: ["Papers to read"] }),
    note("c", "Café notes", { updatedAt: 20 }),
    note("d", "Mask design", { updatedAt: 5 }),
  ];

  it("puts recently opened notes first when the query is empty", () => {
    expect(switcherMatches(notes, " ", { d: 100, a: 50 }).map((match) => match.note.id)).toEqual(["d", "a", "b", "c"]);
    expect(switcherMatches(notes, "", {}, 2).map((match) => match.note.id)).toEqual(["b", "c"]);
  });

  it("fuzzy matches titles and aliases, ignoring accents", () => {
    expect(switcherMatches(notes, "cafe", {}).map((match) => match.note.id)).toEqual(["c"]);
    const papers = switcherMatches(notes, "papers", {});
    expect(papers.map((match) => [match.note.id, match.alias])).toEqual([["b", "Papers to read"]]);
    const mask = switcherMatches(notes, "mask", { a: 5 });
    expect(mask.map((match) => match.note.id).slice(0, 2).sort()).toEqual(["a", "d"]);
    expect(switcherMatches(notes, "zzzz", {})).toEqual([]);
  });

  it("breaks equal scores by recent opens, then recent edits", () => {
    const twins = [note("x", "Same", { updatedAt: 1 }), note("y", "Same", { updatedAt: 2 }), note("z", "Same", { updatedAt: 0 })];
    expect(switcherMatches(twins, "same", { z: 9 }).map((match) => match.note.id)).toEqual(["z", "y", "x"]);
  });

  it("knows when a title or alias already uses the name", () => {
    expect(hasExactTitle(notes, " reading LIST ")).toBe(true);
    expect(hasExactTitle(notes, "papers to read")).toBe(true);
    expect(hasExactTitle(notes, "cafe notes")).toBe(true);
    expect(hasExactTitle(notes, "reading")).toBe(false);
  });
});

describe("linking the first mention", () => {
  const href = "oleafly://note/n-1";

  it("links the first whole-word mention outside front matter, code and links", () => {
    const source = [
      "---",
      "title: Masking notes",
      "---",
      "```",
      "masking in code",
      "```",
      "See `masking` and [masking](https://x.org) and https://x.org/masking and <https://masking.org>.",
      "Premasking is not it, but MASKING is.",
      "Masking again.",
    ].join("\n");
    const linked = linkFirstMention(source, ["Masking"], href);
    expect(linked?.split("\n")[7]).toBe("Premasking is not it, but [MASKING](oleafly://note/n-1) is.");
    expect(linked?.split("\n")[8]).toBe("Masking again.");
    expect(linked?.startsWith("---\ntitle: Masking notes\n---\n")).toBe(true);
  });

  it("picks the earliest of several names and keeps accents and brackets safe", () => {
    expect(linkFirstMention("We used MAE, then the masked encoder.", ["masked encoder", "MAE"], href)).toBe(
      "We used [MAE](oleafly://note/n-1), then the masked encoder.",
    );
    expect(linkFirstMention("Une étude sur l'ete.", ["Étude"], href)).toBe("Une [étude](oleafly://note/n-1) sur l'ete.");
    expect(linkFirstMention("Read [draft] v2 now", ["[draft] v2"], href)).toBe(
      "Read [\\[draft\\] v2](oleafly://note/n-1) now",
    );
    expect(linkFirstMention("été x", ["ete"], href)).toBe("[été](oleafly://note/n-1) x");
  });

  it("matches inside words for scripts without spaces", () => {
    expect(linkFirstMention("今日の研究ノート", ["研究"], href)).toBe("今日の[研究](oleafly://note/n-1)ノート");
  });

  it("skips fenced blocks until the matching fence closes", () => {
    const source = "~~~~\nalpha\n~~~\nalpha\n~~~~\nalpha";
    expect(linkFirstMention(source, ["alpha"], href)).toBe("~~~~\nalpha\n~~~\nalpha\n~~~~\n[alpha](oleafly://note/n-1)");
  });

  it("returns null when nothing can be linked", () => {
    expect(linkFirstMention("Only [Masking](oleafly://note/n-1) here.", ["Masking"], href)).toBeNull();
    expect(linkFirstMention("Nothing", ["", "  "], href)).toBeNull();
  });
});

describe("useNoteTagCounts", () => {
  it("loads tags once per notes list and reloads when notes change", async () => {
    const counts: NoteTagCount[] = [{ tag: "ml", label: "ml", count: 1, notes: ["a"] }];
    const noteTags = vi.fn(async () => counts);
    const value = { current: data({ notes: [note("a", "A")], noteTags }) };
    const { result, rerender, unmount } = renderHook(() => useNoteTagCounts(), { wrapper: wrapperFor(value) });
    await waitFor(() => expect(result.current).toEqual(counts));
    renderHook(() => useNoteTagCounts(), { wrapper: wrapperFor(value) });
    expect(noteTags).toHaveBeenCalledTimes(1);
    value.current = { ...value.current, notes: [note("b", "B")] };
    rerender();
    await waitFor(() => expect(noteTags).toHaveBeenCalledTimes(2));
    unmount();
  });

  it("stays empty without a tag source and logs failures", async () => {
    const { result } = renderHook(() => useNoteTagCounts(), { wrapper: wrapperFor({ current: data({}) }) });
    expect(result.current).toBeNull();
    const failing = { current: data({ noteTags: vi.fn(async () => Promise.reject(new Error("boom"))) }) };
    renderHook(() => useNoteTagCounts(), { wrapper: wrapperFor(failing) });
    await waitFor(() => expect(log.logError).toHaveBeenCalledWith("read note tags", expect.any(Error)));
  });

  it("ignores a load that finishes after unmount", async () => {
    let finish: (value: NoteTagCount[]) => void = () => {};
    const noteTags = vi.fn(() => new Promise<NoteTagCount[]>((resolve) => (finish = resolve)));
    const { result, unmount } = renderHook(() => useNoteTagCounts(), {
      wrapper: wrapperFor({ current: data({ notes: [note("late", "Late")], noteTags }) }),
    });
    unmount();
    await act(async () => finish([]));
    expect(result.current).toBeNull();
  });
});

let schema: ReturnType<typeof buildNoteSearchSchema>;

beforeAll(async () => {
  await loadNamespace("notes");
  schema = buildNoteSearchSchema(i18n.t.bind(i18n) as never, { favorites: new Set(["b"]), tags: null, projects: [] });
});

function planFor(query: string) {
  const context = { now: 0 };
  return vaultPlan(analyze(query, schema, context), schema, context);
}

describe("useVaultSearch", () => {
  it("debounces, drops stale answers and hides hits for unknown notes", async () => {
    vi.useFakeTimers();
    const answers: Record<string, (hits: NoteSearchHit[]) => void> = {};
    const searchNotes = vi.fn(
      (query: string) => new Promise<readonly NoteSearchHit[]>((resolve) => (answers[query] = resolve)),
    );
    const value = { current: data({ notes: [note("a", "A"), note("b", "B")], searchNotes }) };
    const { result, rerender } = renderHook(({ query }) => useVaultSearch(planFor(query), true, 5), {
      initialProps: { query: "mask" },
      wrapper: wrapperFor(value),
    });
    expect(result.current).toEqual({ hits: null, pending: true });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(searchNotes).toHaveBeenCalledWith("mask", 5);
    rerender({ query: "masking" });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    await act(async () => answers.mask([hit("a")]));
    expect(result.current.pending).toBe(true);
    await act(async () => answers.masking([hit("b"), hit("gone")]));
    expect(result.current).toEqual({ hits: [hit("b")], pending: false });
    rerender({ query: "  " });
    expect(result.current).toEqual({ hits: null, pending: false });
  });

  it("keeps the last hits on screen while the next search runs", async () => {
    vi.useFakeTimers();
    const answers: Record<string, (hits: NoteSearchHit[]) => void> = {};
    const searchNotes = vi.fn(
      (query: string) => new Promise<readonly NoteSearchHit[]>((resolve) => (answers[query] = resolve)),
    );
    const value = { current: data({ notes: [note("a", "A"), note("b", "B")], searchNotes }) };
    const { result, rerender } = renderHook(({ query }) => useVaultSearch(planFor(query), true), {
      initialProps: { query: "mask" },
      wrapper: wrapperFor(value),
    });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    await act(async () => answers.mask([hit("a")]));
    rerender({ query: "mask OR read" });
    expect(result.current).toEqual({ hits: [hit("a")], pending: true });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    await act(async () => answers.read([hit("b")]));
    expect(result.current).toEqual({ hits: [hit("a"), hit("b")], pending: false });
  });

  it("reports a failed search as no hits and ignores a stale failure", async () => {
    vi.useFakeTimers();
    const rejects: Record<string, (error: Error) => void> = {};
    const searchNotes = vi.fn(
      (query: string) => new Promise<readonly NoteSearchHit[]>((_resolve, reject) => (rejects[query] = reject)),
    );
    const value = { current: data({ searchNotes }) };
    const { result, rerender } = renderHook(({ query }) => useVaultSearch(planFor(query), true), {
      initialProps: { query: "one" },
      wrapper: wrapperFor(value),
    });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    rerender({ query: "two" });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    await act(async () => rejects.one(new Error("old")));
    expect(log.logError).not.toHaveBeenCalled();
    await act(async () => rejects.two(new Error("boom")));
    expect(result.current).toEqual({ hits: [], pending: false });
    expect(log.logError).toHaveBeenCalledWith("search notes", expect.any(Error));
  });

  it("does nothing without a search source or while turned off", () => {
    const { result } = renderHook(() => useVaultSearch(planFor("mask"), true), { wrapper: wrapperFor({ current: data({}) }) });
    expect(result.current).toEqual({ hits: null, pending: false });
    const searchNotes = vi.fn(async () => [hit("a")]);
    const off = renderHook(() => useVaultSearch(planFor("mask"), false), {
      wrapper: wrapperFor({ current: data({ notes: [note("a", "A")], searchNotes }) }),
    });
    expect(off.result.current).toEqual({ hits: null, pending: false });
    expect(searchNotes).not.toHaveBeenCalled();
  });

  it("searches each side of an OR and keeps the filters that belong to each side", async () => {
    vi.useFakeTimers();
    const searchNotes = vi.fn(async (query: string) =>
      query === "mask" ? [hit("a", "A", 2), hit("b", "B", 1)] : [hit("c", "C", 3)],
    );
    const notes = [note("a", "A"), note("b", "B"), note("c", "C")];
    const { result } = renderHook(() => useVaultSearch(planFor("(mask is:favorite) OR read"), true), {
      wrapper: wrapperFor({ current: data({ notes, searchNotes }) }),
    });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(searchNotes.mock.calls).toEqual([
      ["mask", 50],
      ["read", 50],
    ]);
    expect(result.current.hits?.map((item) => item.id)).toEqual(["c", "b"]);
  });

  it("adds the notes a side without words matches to the search hits", async () => {
    vi.useFakeTimers();
    const searchNotes = vi.fn(async () => [hit("a", "A", 2)]);
    const notes = [note("a", "A"), note("b", "B"), note("c", "C")];
    const { result } = renderHook(() => useVaultSearch(planFor("mask OR is:favorite"), true), {
      wrapper: wrapperFor({ current: data({ notes, searchNotes }) }),
    });
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(searchNotes).toHaveBeenCalledTimes(1);
    expect(result.current.hits?.map((item) => [item.id, item.snippets.length])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });
});
