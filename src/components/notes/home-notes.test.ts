import { describe, expect, it } from "vitest";
import { createdAt, homeNotes, openedAt, type HomeQuery } from "./home-notes";
import type { NoteItem } from "./types";

function note(id: string, overrides: Partial<NoteItem> = {}): NoteItem {
  return { id, title: id, project: "Notes", updatedAt: 100, author: "you", summary: "", ...overrides };
}

const QUERY: HomeQuery = { tab: "mine", favorites: new Set(), sort: "edited", opened: {} };

function ids(notes: readonly NoteItem[], query: Partial<HomeQuery>): string[] {
  return homeNotes(notes, { ...QUERY, ...query }).map((item) => item.id);
}

describe("home notes", () => {
  it("falls back to the edit time when a note was never opened or has no creation time", () => {
    const item = note("a", { updatedAt: 50 });
    expect(openedAt(item, {})).toBe(50);
    expect(openedAt(item, { a: 70 })).toBe(70);
    expect(createdAt(item)).toBe(50);
    expect(createdAt({ ...item, createdAt: 10 })).toBe(10);
  });

  it("sorts newest first by edit, open or creation time and breaks ties by id", () => {
    const notes = [
      note("b", { updatedAt: 300, createdAt: 30 }),
      note("a", { updatedAt: 300, createdAt: 10 }),
      note("c", { updatedAt: 200, createdAt: 50 }),
    ];
    expect(ids(notes, { sort: "edited" })).toEqual(["a", "b", "c"]);
    expect(ids(notes, { sort: "created" })).toEqual(["c", "b", "a"]);
    expect(ids(notes, { sort: "opened", opened: { c: 900 } })).toEqual(["c", "a", "b"]);
  });

  it("sorts titles in reading order, numbers by value, ignoring case", () => {
    const notes = [note("1", { title: "run 10" }), note("2", { title: "Run 9" }), note("3", { title: "alpha" }), note("4", { title: "Alpha" })];
    expect(ids(notes, { sort: "title" })).toEqual(["3", "4", "2", "1"]);
  });

  it("shows only favorites on the Favorites tab", () => {
    const notes = [note("a"), note("b")];
    expect(ids(notes, { tab: "favorites", favorites: new Set(["b", "gone"]) })).toEqual(["b"]);
    expect(ids(notes, { tab: "mine", favorites: new Set(["b"]) })).toEqual(["a", "b"]);
  });

  it("keeps the notes the search lets through", () => {
    const notes = [note("a", { title: "Masking" }), note("b")];
    expect(ids(notes, { test: (item) => item.title === "Masking" })).toEqual(["a"]);
    expect(ids(notes, {})).toEqual(["a", "b"]);
  });

  it("uses the full-text matches when the vault search has them, like the sidebar", () => {
    const notes = [note("a", { title: "Masking" }), note("b", { title: "Reading" })];
    expect(ids(notes, { test: () => false, matches: new Set(["b"]) })).toEqual(["b"]);
    expect(ids(notes, { test: (item) => item.id === "a", matches: null })).toEqual(["a"]);
  });
});
