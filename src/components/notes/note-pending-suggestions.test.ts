// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blockTrusted, setBlockTrusted } from "./block-trust";
import { applyNoteEdits } from "./note-edits";
import {
  addPendingBatch,
  editsBetween,
  forgetNoteLeftovers,
  keepReview,
  keptReview,
  noteEditorLink,
  notesWithSuggestions,
  pendingBatches,
  proposeNoteEdits,
  registerNoteEditor,
  resetPendingSuggestionsForTest,
  reviewedNoteSource,
  takePendingBatches,
  useWaitingSuggestions,
  withPendingEdits,
} from "./note-pending-suggestions";
import { indexedUndoStore } from "./note-undo-store";

const KEY = "oleafly.notes.pendingSuggestions";

afterEach(() => {
  localStorage.clear();
  resetPendingSuggestionsForTest();
  vi.restoreAllMocks();
});

function replay(base: string, target: string): string {
  const edits = editsBetween(base, target);
  const applied = applyNoteEdits(base, edits);
  expect(applied.skipped).toBe(0);
  return applied.text;
}

describe("turning shown suggestions into edits", () => {
  it.each([
    ["one changed line", "# Title\n\nFirst.\n\nSecond.\n", "# Title\n\nFirst, changed.\n\nSecond.\n"],
    ["two separate changes", "a\nb\nc\nd\ne\nf\n", "a\nB\nc\nd\nE\nf\n"],
    ["repeated lines", "x\nsame\nx\nsame\nx\n", "x\nsame\ny\nsame\nx\n"],
    ["an insertion between blank lines", "One.\n\nTwo.\n", "One.\n\nNew.\n\nTwo.\n"],
    ["an insertion at the start", "Body\n", "Lead\nBody\n"],
    ["a deletion at the end", "Keep\nDrop\n", "Keep\n"],
    ["changes next to each other that share context", "p\nq\np\nq\np\n", "P\nq\nP\nq\nP\n"],
    ["an empty note", "", "Fresh text"],
    ["a note emptied", "Gone\n", ""],
  ])("writes %s as edits that rebuild the target", (_name, base, target) => {
    expect(replay(base, target)).toBe(target);
  });

  it("returns no edits when nothing changed", () => {
    expect(editsBetween("same", "same")).toEqual([]);
  });

  it("keeps each edit small when the change is unique", () => {
    expect(editsBetween("# T\n\nAlpha.\n\nBeta.\n", "# T\n\nAlpha.\n\nGamma.\n")).toEqual([{ find: "Beta.", replace: "Gamma." }]);
  });

  it("falls back to one edit for the whole text when the change is too large to diff", async () => {
    const diff = await import("@/lib/myers-diff");
    vi.spyOn(diff, "myersEditScript").mockReturnValueOnce(null);
    expect(editsBetween("a", "b")).toEqual([{ find: "a", replace: "b" }]);
  });
});

describe("suggestions waiting for a closed note", () => {
  it("keeps batches in order on this computer and hands them over once", () => {
    addPendingBatch("n1", [{ find: "a", replace: "b" }]);
    addPendingBatch("n1", [{ find: "b", replace: "c" }]);
    addPendingBatch("n1", [{ find: "x", replace: "y" }], true);
    addPendingBatch("n1", []);
    expect(pendingBatches("n1")).toEqual([[{ find: "x", replace: "y" }], [{ find: "a", replace: "b" }], [{ find: "b", replace: "c" }]]);
    resetPendingSuggestionsForTest();
    expect(pendingBatches("n1")).toHaveLength(3);
    expect(withPendingEdits("a", pendingBatches("n1"))).toBe("c");
    expect(takePendingBatches("n1")).toHaveLength(3);
    expect(takePendingBatches("n1")).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("ignores stored data it can't read and survives full storage", () => {
    localStorage.setItem(KEY, "{");
    expect(pendingBatches("n1")).toEqual([]);
    resetPendingSuggestionsForTest();
    localStorage.setItem(KEY, "[1]");
    expect(pendingBatches("n1")).toEqual([]);
    resetPendingSuggestionsForTest();
    localStorage.setItem(KEY, JSON.stringify({ n1: [[{ find: "a", replace: "b" }], [{ find: 1 }], []], n2: "x", n3: [[null]] }));
    expect(pendingBatches("n1")).toEqual([[{ find: "a", replace: "b" }]]);
    expect(pendingBatches("n2")).toEqual([]);
    expect(pendingBatches("n3")).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => addPendingBatch("n4", [{ find: "a", replace: "b" }])).not.toThrow();
    expect(pendingBatches("n4")).toHaveLength(1);
  });

  it("drops the oldest notes' suggestions when they grow too large to keep", () => {
    const big = "x".repeat(600_000);
    addPendingBatch("old", [{ find: "a", replace: big }]);
    addPendingBatch("new", [{ find: "b", replace: big }]);
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY) ?? "{}"))).toEqual(["new"]);
  });
});

describe("forgetting a deleted note", () => {
  it("drops its waiting suggestions and its trusted blocks, and keeps other notes'", () => {
    addPendingBatch("gone", [{ find: "secret", replace: "more secret" }]);
    addPendingBatch("kept", [{ find: "a", replace: "b" }]);
    setBlockTrusted({ note: "gone", hash: "1" }, true);
    setBlockTrusted({ note: "kept", hash: "2" }, true);
    keepReview("gone", { file: [{ find: "secret outside", replace: "mine" }], proposed: [] });
    forgetNoteLeftovers("gone");
    expect(keptReview("gone")).toEqual({ file: [], proposed: [] });
    expect(pendingBatches("gone")).toEqual([]);
    expect(pendingBatches("kept")).toHaveLength(1);
    expect(localStorage.getItem(KEY)).not.toContain("secret");
    expect(blockTrusted({ note: "gone", hash: "1" })).toBe(false);
    expect(blockTrusted({ note: "kept", hash: "2" })).toBe(true);
  });

  it("drops its kept undo history", () => {
    const remove = vi.spyOn(indexedUndoStore, "remove").mockResolvedValue(undefined);
    forgetNoteLeftovers("gone");
    expect(remove).toHaveBeenCalledWith("gone");
  });
});

describe("open note editors", () => {
  it("finds the editor showing a note until it closes", () => {
    const link = { readSource: () => "text", propose: () => 1, pending: () => 0 };
    const stop = registerNoteEditor("n1", link);
    expect(noteEditorLink("n1")).toBe(link);
    const other = registerNoteEditor("n1", { ...link });
    stop();
    expect(noteEditorLink("n1")).not.toBe(link);
    other();
    expect(noteEditorLink("n1")).toBeNull();
  });

  it("goes back to the editor still open when the newer one closes", () => {
    const first = { readSource: () => "first", propose: () => 1, pending: () => 0 };
    const second = { readSource: () => "second", propose: () => 1, pending: () => 0 };
    const stopFirst = registerNoteEditor("n1", first);
    const stopSecond = registerNoteEditor("n1", second);
    expect(noteEditorLink("n1")).toBe(second);
    stopSecond();
    expect(noteEditorLink("n1")).toBe(first);
    stopFirst();
    expect(noteEditorLink("n1")).toBeNull();
  });
});

describe("suggestions from outside the editor", () => {
  it("shows them in the open editor, or keeps them for a closed note", () => {
    const propose = vi.fn(() => 2);
    const stop = registerNoteEditor("open", { readSource: () => "live", propose, pending: () => 0 });
    expect(proposeNoteEdits("open", [{ find: "", replace: "x" }])).toBe(2);
    expect(pendingBatches("open")).toEqual([]);
    expect(proposeNoteEdits("closed", [{ find: "", replace: "y" }])).toBe(1);
    expect(pendingBatches("closed")).toEqual([[{ find: "", replace: "y" }]]);
    stop();
  });

  it("reads the editor text, or the saved text with the waiting suggestions on top", async () => {
    const stop = registerNoteEditor("open", { readSource: () => "live", propose: () => 1, pending: () => 0 });
    expect(reviewedNoteSource("open", async () => ({ text: "disk" }))).toBe("live");
    stop();
    addPendingBatch("closed", [{ find: "old", replace: "new" }]);
    expect(await reviewedNoteSource("closed", async () => ({ text: "the old line" }))).toBe("the new line");
  });

  it("knows which notes have suggestions waiting and tells a row when that changes", () => {
    const { result } = renderHook(() => useWaitingSuggestions("n1"));
    expect(result.current).toBe(false);
    act(() => addPendingBatch("n1", [{ find: "a", replace: "b" }]));
    expect(result.current).toBe(true);
    act(() => keepReview("n2", { file: [{ find: "c", replace: "d" }], proposed: [] }));
    expect([...notesWithSuggestions()].sort()).toEqual(["n1", "n2"]);
    act(() => void takePendingBatches("n1"));
    expect(result.current).toBe(false);
    expect([...notesWithSuggestions()]).toEqual(["n2"]);
  });
});
