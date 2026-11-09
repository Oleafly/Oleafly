import type { RemoteChange } from "@oleafly/editor/document-session";
import { describe, expect, it, vi } from "vitest";
import { browserClock, NoteLiveBinding, REMOTE_FRAME_MS, type NoteLiveClock, type NoteLiveSession } from "./note-live";

function fakeSession(start: string) {
  let text = start;
  let listener: ((change: RemoteChange) => void) | null = null;
  const session: NoteLiveSession = {
    readOnly: false,
    version: () => 0,
    text: () => text,
    applyLocal: () => {},
    subscribe: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  const remote = (next: string) => {
    const before = text;
    text = next;
    listener?.({ edits: [{ from: 0, to: before.length, insert: next }] } as unknown as RemoteChange);
  };
  return { session, remote };
}

function fakeClock() {
  let time = 1000;
  const soon: (() => void)[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const clock: NoteLiveClock = {
    now: () => time,
    soon: (run) => soon.push(run),
    later: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return () => {
        timers.splice(timers.indexOf(timer), 1);
      };
    },
  };
  return {
    clock,
    soon,
    timers,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("remote batch coalescing", () => {
  it("applies the first remote batch at once and folds a burst into one frame", () => {
    const { session, remote } = fakeSession("one");
    let shown = "one";
    const show = vi.fn((_previous: string, next: string) => {
      shown = next;
    });
    const editor = { serialize: () => shown, show, composing: () => false };
    const time = fakeClock();
    const binding = new NoteLiveBinding({ session, editor, clock: time.clock });
    remote("two");
    expect(time.soon).toHaveLength(1);
    time.soon.shift()?.();
    expect(show).toHaveBeenCalledTimes(1);
    time.advance(2);
    remote("three");
    remote("four");
    expect(time.soon).toHaveLength(0);
    expect(time.timers).toHaveLength(1);
    expect(time.timers[0].ms).toBe(REMOTE_FRAME_MS - 2);
    time.advance(REMOTE_FRAME_MS);
    time.timers.shift()?.run();
    expect(show).toHaveBeenCalledTimes(2);
    expect(shown).toBe("four");
    time.advance(REMOTE_FRAME_MS * 2);
    remote("five");
    expect(time.soon).toHaveLength(1);
    binding.detach();
  });

  it("reads the time from the browser clock", () => {
    expect(typeof browserClock.now?.()).toBe("number");
  });
});
