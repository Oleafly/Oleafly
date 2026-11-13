// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushOpenNotes,
  noteEditorBusy,
  noteEditorOpen,
  noteHistoryAt,
  openNoteEditor,
  openNoteText,
  registerNoteEditor,
  trackNoteSave,
  waitForNoteEditor,
} from "./open-note-editors";
import { noteEditorHandle } from "./tests/open-note-editor-fixtures";

function job(title: string) {
  return { title: () => title, timedOut: () => `${title} timed out` };
}

const stops: (() => void)[] = [];

function open(id: string, handle = noteEditorHandle()) {
  const stop = registerNoteEditor(id, handle);
  stops.push(stop);
  return stop;
}

async function settle() {
  for (let round = 0; round < 3; round += 1) await Promise.resolve();
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

describe("open note editors", () => {
  it("counts a note as open while any editor shows it", () => {
    expect(noteEditorOpen("a")).toBe(false);
    const first = open("a");
    const second = open("a");
    expect(noteEditorOpen("a")).toBe(true);
    first();
    expect(noteEditorOpen("a")).toBe(true);
    second();
    expect(noteEditorOpen("a")).toBe(false);
  });

  it("reads the text of the latest editor open on a note", () => {
    expect(openNoteText("a")).toBeNull();
    const first = open("a", noteEditorHandle({ text: () => "first" }));
    const second = open("a", noteEditorHandle({ text: () => "second" }));
    expect(openNoteText("a")).toBe("second");
    second();
    expect(openNoteText("a")).toBe("first");
    first();
    expect(openNoteEditor("a")).toBeNull();
  });

  it("says a note is busy while any of its editors has an unsaved change", () => {
    let pending = false;
    open("a", noteEditorHandle({ busy: () => pending }));
    open("a");
    expect(noteEditorBusy("a")).toBe(false);
    pending = true;
    expect(noteEditorBusy("a")).toBe(true);
    expect(noteEditorBusy("other")).toBe(false);
  });

  it("waits for an editor to open, and gives up when told to", async () => {
    const abort = new AbortController();
    const waiting = waitForNoteEditor("b", abort.signal);
    open("c", noteEditorHandle({ text: () => "other" }));
    const opened = noteEditorHandle({ text: () => "b" });
    const stop = open("b", opened);
    await expect(waiting).resolves.toBe(opened);
    await expect(waitForNoteEditor("b", abort.signal)).resolves.toBe(opened);
    stop();
    const gaveUp = waitForNoteEditor("b", abort.signal);
    abort.abort();
    await expect(gaveUp).resolves.toBeNull();
    await expect(waitForNoteEditor("b", abort.signal)).resolves.toBeNull();
  });
});

describe("flushing open notes", () => {
  it("saves every open note and names the ones that could not be saved", async () => {
    const saved = vi.fn(async () => null);
    open("saved", noteEditorHandle({ ...job("Saved"), flush: saved }));
    open("failed", noteEditorHandle({ ...job("Failed"), flush: async () => "disk full" }));
    open(
      "threw",
      noteEditorHandle({
        ...job("Threw"),
        flush: async () => {
          throw new Error("locked");
        },
      }),
    );
    open("odd", noteEditorHandle({ ...job("Odd"), flush: () => Promise.reject("refused") }));
    await expect(flushOpenNotes()).resolves.toEqual([
      { path: "Failed", reason: "disk full" },
      { path: "Threw", reason: "locked" },
      { path: "Odd", reason: "refused" },
    ]);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("flushes each editor once when two editors show the same note", async () => {
    const first = vi.fn(async () => null);
    const second = vi.fn(async () => null);
    open("same", noteEditorHandle({ flush: first }));
    open("same", noteEditorHandle({ flush: second }));
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("stops waiting for a note that takes too long", async () => {
    vi.useFakeTimers();
    open("slow", noteEditorHandle({ ...job("Slow"), flush: () => new Promise(() => {}) }));
    const flushing = flushOpenNotes(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(flushing).resolves.toEqual([{ path: "Slow", reason: "Slow timed out" }]);
  });

  it("forgets a note once it closes", async () => {
    const flush = vi.fn(async () => "never");
    open("closed", noteEditorHandle({ ...job("Closed"), flush }))();
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(flush).not.toHaveBeenCalled();
  });

  it("waits for a save a closed note started", async () => {
    let finish: (reason: string | null) => void = () => {};
    trackNoteSave(job("Closing"), new Promise((resolve) => (finish = resolve)));
    const flushing = flushOpenNotes();
    finish("disk full");
    await expect(flushing).resolves.toEqual([{ path: "Closing", reason: "disk full" }]);
    await expect(flushOpenNotes()).resolves.toEqual([]);
    trackNoteSave(job("Broken"), Promise.reject(new Error("gone")));
    await expect(flushOpenNotes()).resolves.toEqual([{ path: "Broken", reason: "gone" }]);
    await expect(flushOpenNotes()).resolves.toEqual([]);
  });

  it("keeps a save that failed after its note closed until a flush reports it", async () => {
    trackNoteSave(job("Closed early"), Promise.resolve("disk full"));
    await settle();
    await expect(flushOpenNotes()).resolves.toEqual([{ path: "Closed early", reason: "disk full" }]);
    await expect(flushOpenNotes()).resolves.toEqual([]);
  });

  it("tries a failed save of a closed note again when the app flushes", async () => {
    const retry = vi.fn(async () => null);
    trackNoteSave(job("Retried"), Promise.resolve("disk full"), retry);
    await settle();
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(retry).toHaveBeenCalledOnce();
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("names a closed note whose second try fails too", async () => {
    const retry = vi.fn(async () => "still full");
    trackNoteSave(job("Still failing"), Promise.resolve("disk full"), retry);
    await settle();
    await expect(flushOpenNotes()).resolves.toEqual([{ path: "Still failing", reason: "still full" }]);
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(retry).toHaveBeenCalledOnce();
  });

  it("waits for a closed note's save that is still running instead of trying again", async () => {
    let finish: (reason: string | null) => void = () => {};
    const retry = vi.fn(async () => null);
    trackNoteSave(job("Running"), new Promise((resolve) => (finish = resolve)), retry);
    const flushing = flushOpenNotes();
    finish("disk full");
    await expect(flushing).resolves.toEqual([{ path: "Running", reason: "disk full" }]);
    expect(retry).not.toHaveBeenCalled();
  });

  it("forgets a closed note's save once it succeeds", async () => {
    const retry = vi.fn(async () => "never");
    trackNoteSave(job("Fine"), Promise.resolve(null), retry);
    await expect(flushOpenNotes()).resolves.toEqual([]);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("undo in an open note", () => {
  it("finds the note that holds the focused element until the note closes", () => {
    const root = document.createElement("div");
    const inside = document.createElement("button");
    root.append(inside);
    document.body.append(root);
    const run = vi.fn();
    const stop = open("note", noteEditorHandle({ root, history: run }));
    open("rootless");
    expect(noteHistoryAt(inside)).toBe(run);
    expect(noteHistoryAt(document.body)).toBeNull();
    expect(noteHistoryAt(null)).toBeNull();
    stop();
    expect(noteHistoryAt(inside)).toBeNull();
    root.remove();
  });
});
