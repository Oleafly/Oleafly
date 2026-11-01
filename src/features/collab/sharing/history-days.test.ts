import { describe, expect, it } from "vitest";
import type { CollabHistoryEntry } from "@/lib/tauri";
import { olderFirst } from "./history-days";

function entry(id: string, at: number): CollabHistoryEntry {
  return { id, at, until: at, authors: [], files: [], name: null, versionId: null };
}

describe("olderFirst", () => {
  const newer = entry("v2", 2_000);
  const older = entry("v1", 1_000);
  const listed = [newer, older];

  it("puts the older entry first whichever was picked first", () => {
    expect(olderFirst(newer, older, listed)).toEqual([older, newer]);
    expect(olderFirst(older, newer, listed)).toEqual([older, newer]);
  });

  it("still orders a pick made before the list reloaded", () => {
    const reloaded = [entry("v3", 3_000), entry("v2", 2_000), entry("v1", 1_000)];
    const [first, second] = olderFirst(entry("v1", 1_000), reloaded[1], reloaded);
    expect([first.id, second.id]).toEqual(["v1", "v2"]);
  });

  it("falls back to the times when an entry is no longer listed", () => {
    const [first, second] = olderFirst(newer, entry("v0", 500), [newer]);
    expect([first.id, second.id]).toEqual(["v0", "v2"]);
  });
});
