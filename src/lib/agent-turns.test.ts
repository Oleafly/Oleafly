import { describe, expect, it } from "vitest";
import { turnChangesFrom } from "./agent-turns";

describe("turnChangesFrom", () => {
  it("reads the turn_changes event payload the runtime emits", () => {
    const parsed = turnChangesFrom({
      turnId: "turn-1",
      snapshotId: "snap-1",
      files: [
        {
          index: 0, path: "main.tex", change: "modified", beforeSize: 10, afterSize: 12,
          added: 2, removed: 1, alsoEditedHere: false, build: false,
        },
      ],
      moreFiles: 3,
      skipped: [{ path: "data.bin", reason: "too_large" }],
      overlapped: true,
      unavailable: null,
    });
    expect(parsed).toEqual({
      snapshotId: "snap-1",
      files: [
        {
          index: 0, path: "main.tex", change: "modified", beforeSize: 10, afterSize: 12,
          added: 2, removed: 1, alsoEditedHere: false, build: false,
        },
      ],
      moreFiles: 3,
      skipped: [{ path: "data.bin", reason: "too_large" }],
      overlapped: true,
      unavailable: null,
    });
  });

  it("drops malformed file rows and fills safe defaults", () => {
    const parsed = turnChangesFrom({
      files: [
        { index: 4, path: "refs.bib", change: "added" },
        { index: "x", path: "bad.tex", change: "modified" },
        { index: 5, path: "", change: "modified" },
        { index: 6, path: "odd.tex", change: "renamed" },
      ],
      unavailable: "too_large",
    });
    expect(parsed).toEqual({
      snapshotId: null,
      files: [
        {
          index: 4, path: "refs.bib", change: "added", beforeSize: null, afterSize: null,
          added: null, removed: null, alsoEditedHere: false, build: false,
        },
      ],
      moreFiles: 0,
      skipped: [],
      overlapped: false,
      unavailable: "too_large",
    });
  });

  it("returns null for anything that is not an object", () => {
    expect(turnChangesFrom(null)).toBeNull();
    expect(turnChangesFrom("changes")).toBeNull();
    expect(turnChangesFrom([])).toBeNull();
  });

  it("ignores an unknown unavailable code", () => {
    expect(turnChangesFrom({ files: [], unavailable: "melted" })?.unavailable).toBe("error");
  });
});
