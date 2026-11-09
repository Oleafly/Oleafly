import { afterEach, describe, expect, it, vi } from "vitest";
import { flushOpenNotes, registerNoteFlush, trackNoteSave } from "./open-note-editors";

function job(title: string) {
  return { title: () => title, timedOut: () => `${title} timed out` };
}

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

describe("flushing open notes", () => {
  it("saves every open note and names the ones that could not be saved", async () => {
    const saved = vi.fn(async () => null);
    stops.push(registerNoteFlush({ ...job("Saved"), flush: saved }));
    stops.push(registerNoteFlush({ ...job("Failed"), flush: async () => "disk full" }));
    stops.push(
      registerNoteFlush({
        ...job("Threw"),
        flush: async () => {
          throw new Error("locked");
        },
      }),
    );
    stops.push(
      registerNoteFlush({
        ...job("Odd"),
        flush: () => Promise.reject("refused"),
      }),
    );
    await expect(flushOpenNotes()).resolves.toEqual([
      { path: "Failed", reason: "disk full" },
      { path: "Threw", reason: "locked" },
      { path: "Odd", reason: "refused" },
    ]);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("stops waiting for a note that takes too long", async () => {
    vi.useFakeTimers();
    stops.push(registerNoteFlush({ ...job("Slow"), flush: () => new Promise(() => {}) }));
    const flushing = flushOpenNotes(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(flushing).resolves.toEqual([{ path: "Slow", reason: "Slow timed out" }]);
  });

  it("forgets a note once it closes", async () => {
    const flush = vi.fn(async () => "never");
    registerNoteFlush({ ...job("Closed"), flush })();
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
});
