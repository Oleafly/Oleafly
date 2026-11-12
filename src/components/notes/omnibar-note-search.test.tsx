// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NoteSearchHit } from "@/lib/tauri";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import "./tests/setup";

const mocks = vi.hoisted(() => ({
  noteSearch: vi.fn(async (_query: string, _limit?: number | null, _options?: unknown): Promise<NoteSearchHit[]> => []),
  vaultSnapshot: vi.fn(),
}));

vi.mock("@/lib/tauri", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tauri")>()), noteSearch: mocks.noteSearch }));
vi.mock("./app-notes", () => ({ vaultSnapshot: mocks.vaultSnapshot }));

import { mergeHits, useVaultQuery } from "./note-query";
import { NotesDataProvider } from "./notes-data";
import { omnibarNoteSearch } from "./omnibar-note-search";
import { fakeNotesData } from "./tests/notes-data-fixture";
import type { NoteItem } from "./types";

function note(id: string, extra: Partial<NoteItem> = {}): NoteItem {
  return { id, title: id, project: "Notes", updatedAt: 0, author: "you", summary: "", ...extra };
}

const NOTES: NoteItem[] = [
  note("agent-mask", { title: "Masking run", author: "agent", tags: ["ml"] }),
  note("my-mask", { title: "Masking plan", tags: ["draft"] }),
  note("vision", { title: "Vision notes", project: "Vision", relatedProjectId: "p-vision" }),
  note("starred", { title: "Starred idea" }),
];

const QUERIES = ["tag:ml,draft mask", "author:agent mask", "is:favorite", "project:Vision", "kind:figure", "(mask OR plan) -author:agent"];

function hit(id: string, score: number): NoteSearchHit {
  return { id, noteId: null, title: id, titleRanges: [], score, snippets: [], tags: [], aliases: [], relatedProject: null, updatedAt: 0 };
}

function libraryPlan(source: string) {
  const data = fakeNotesData({ notes: NOTES });
  const wrapper = ({ children }: { children: ReactNode }) => <NotesDataProvider value={data}>{children}</NotesDataProvider>;
  return renderHook(() => useVaultQuery(source, null), { wrapper }).result.current.plan;
}

function sent(): string[] {
  return mocks.noteSearch.mock.calls.map(([query]) => query);
}

beforeEach(() => {
  mocks.noteSearch.mockReset().mockImplementation(async () => [hit("agent-mask", 2), hit("my-mask", 1), hit("gone", 3)]);
  mocks.vaultSnapshot.mockReset().mockResolvedValue({ notes: NOTES, facts: [] });
  useNotesPrefsStore.setState({ favorites: ["starred"] });
});

describe("omnibarNoteSearch", () => {
  it("sends the searches the Notes library sends and keeps the hits it keeps", async () => {
    const search = omnibarNoteSearch();
    for (const query of QUERIES) {
      mocks.noteSearch.mockClear();
      const found = await search(query, 20, "ranked");
      const plan = libraryPlan(query);
      expect(sent()).toEqual(plan.searches);
      const results = await Promise.all(plan.searches.map(async () => [hit("agent-mask", 2), hit("my-mask", 1), hit("gone", 3)]));
      expect(found.hits.map((item) => item.id)).toEqual(mergeHits(plan, results, NOTES, 20).map((item) => item.id));
      expect(found.truncated).toBe(plan.truncated);
    }
  });

  it("reads tag lists, authors, favorites, projects and kinds the way the library does", async () => {
    const search = omnibarNoteSearch();
    const run = async (query: string) => {
      mocks.noteSearch.mockClear();
      const found = await search(query, 20, "ranked");
      return { sent: sent(), ids: found.hits.map((item) => item.id) };
    };
    expect(await run("tag:ml,draft mask")).toEqual({ sent: ["tag:ml mask", "tag:draft mask"], ids: ["agent-mask", "my-mask"] });
    expect(await run("author:agent mask")).toEqual({ sent: ["mask"], ids: ["agent-mask"] });
    expect(await run("is:favorite")).toEqual({ sent: [], ids: ["starred"] });
    expect(await run("project:Vision")).toEqual({ sent: [], ids: ["vision"] });
    expect(await run("kind:figure")).toEqual({ sent: [], ids: [] });
  });

  it("searches with the box's mode and asks for blocks", async () => {
    await omnibarNoteSearch()("mask", 5, "exact");
    expect(mocks.noteSearch).toHaveBeenCalledWith("mask", 5, { mode: "exact", blocks: true });
  });

  it("says when a query had more combinations than it searches", async () => {
    const found = await omnibarNoteSearch()("(a OR b OR c OR d OR e OR f) (g OR h OR i OR j OR k OR l)", 20, "ranked");
    expect(found.truncated).toBe(true);
    expect(mocks.noteSearch).toHaveBeenCalledTimes(32);
  });

  it("reads the vault once per search box and again after a failed read", async () => {
    mocks.vaultSnapshot.mockRejectedValueOnce(new Error("index busy"));
    const search = omnibarNoteSearch();
    await expect(search("mask", 20, "ranked")).rejects.toThrow("index busy");
    await search("mask", 20, "ranked");
    await search("plan", 20, "ranked");
    expect(mocks.vaultSnapshot).toHaveBeenCalledTimes(2);
  });
});
