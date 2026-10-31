import { describe, expect, it } from "vitest";
import { mergeComments, parseComments, remapFile, type CommentFile, type PersonalComments } from "./model";

const file = (): CommentFile => ({
  path: "main.typ",
  text: "Intro. Rewrite this. End.",
  notes: [
    { id: "one", body: "Find a source", quote: "Rewrite this", range: { from: 7, to: 19 }, resolved: false },
  ],
});
const data = (entry = file()): PersonalComments => ({ version: 1, files: [entry] });

describe("personal comment anchors", () => {
  it("follows multiple edits and Unicode offsets without touching the source", () => {
    const original = file();
    const result = remapFile(original, "😀 Intro! Rewrite this. New ending.");
    const range = result.notes[0].range;
    expect(result.text.slice(range?.from, range?.to)).toBe("Rewrite this");
    expect(original).toEqual(file());
    expect(result.notes[0].body).toBe("Find a source");
  });

  it("keeps a deleted passage as a detached note, also when resolved", () => {
    const original = file();
    original.notes[0].resolved = true;
    const result = remapFile(original, "Intro. . End.");
    expect(result.notes[0]).toMatchObject({ range: null, quote: "Rewrite this", resolved: true });
  });

  it("reconciles a saved anchor against an older disk buffer on restart", () => {
    const saved = remapFile(file(), "New paragraph. Intro. Rewrite this. End.");
    const reopened = remapFile(parseComments(JSON.parse(JSON.stringify(data(saved)))).files[0], file().text);
    expect(reopened.notes[0].range).toEqual(file().notes[0].range);
  });

  it("does not absorb typing just outside a selected passage", () => {
    const original = file();
    const result = remapFile(original, "Intro. XRewrite thisY. End.");
    expect(result.notes[0].range).toEqual({ from: 8, to: 20 });
  });

  it("rejects corrupt, future, duplicate and out-of-bounds data", () => {
    for (const value of [
      null,
      {},
      { version: 2, files: [] },
      { version: 1, files: [file(), file()] },
      data({ ...file(), notes: [{ ...file().notes[0], range: { from: 1, to: 1000 } }] }),
    ]) {
      expect(() => parseComments(value)).toThrow();
    }
  });
});

describe("multiple windows", () => {
  it("combines independent additions and preserves a deletion", () => {
    const base = data();
    const local = data({ ...file(), notes: [{ ...file().notes[0], id: "local" }] });
    const remote = data({ ...file(), notes: [...file().notes, { ...file().notes[0], id: "remote" }] });
    expect(mergeComments(base, local, remote).files[0].notes.map((note) => note.id)).toEqual([
      "local",
      "remote",
    ]);
  });

  it("keeps both bodies if two windows edit the same note", () => {
    const local = data({ ...file(), notes: [{ ...file().notes[0], body: "Local revision" }] });
    const remote = data({ ...file(), notes: [{ ...file().notes[0], body: "Remote revision" }] });
    const merged = mergeComments(data(), local, remote).files[0].notes;
    expect(merged.map((note) => note.body)).toEqual(["Local revision", "Remote revision"]);
    expect(new Set(merged.map((note) => note.id)).size).toBe(2);
  });
});
