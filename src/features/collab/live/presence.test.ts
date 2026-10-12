import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabPresence } from "@/store/settings";
import {
  createPresencePublisher,
  PRESENCE_INTERVAL_MS,
  PRESENCE_KEEP_ALIVE_MS,
  type Presence,
  visiblePresence,
} from "./presence";

let current: Presence;
const send = vi.fn();
const leave = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  current = { path: "main.tex", cursor: 1, anchor: 1 };
  send.mockClear();
  leave.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("presence publisher", () => {
  it("sends at most once per 150 ms and always the latest selection", () => {
    expect(PRESENCE_INTERVAL_MS).toBe(150);
    const publisher = createPresencePublisher(() => current, send, leave);
    publisher.schedule();
    expect(send).toHaveBeenCalledWith({ path: "main.tex", cursor: 1, anchor: 1 });
    current = { path: "main.tex", cursor: 2, anchor: 2 };
    publisher.schedule();
    current = { path: "main.tex", cursor: 3, anchor: 1 };
    publisher.schedule();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(149);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ path: "main.tex", cursor: 3, anchor: 1 });
  });

  it("repeats the last presence every 15 seconds so others keep seeing an idle person", () => {
    expect(PRESENCE_KEEP_ALIVE_MS).toBe(15_000);
    const publisher = createPresencePublisher(() => current, send, leave);
    publisher.schedule();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ path: "main.tex", cursor: 1, anchor: 1 });
    publisher.dispose();
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 2);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not repeat an unchanged presence", () => {
    const publisher = createPresencePublisher(() => current, send, leave);
    publisher.schedule();
    vi.advanceTimersByTime(200);
    publisher.schedule();
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
    current = { path: null, cursor: null, anchor: null };
    publisher.schedule();
    expect(send).toHaveBeenLastCalledWith({ path: null, cursor: null, anchor: null });
  });

  it("sends nothing after it is disposed", () => {
    const publisher = createPresencePublisher(() => current, send, leave);
    publisher.schedule();
    current = { path: "b.tex", cursor: 0, anchor: 0 };
    publisher.schedule();
    publisher.dispose();
    vi.advanceTimersByTime(500);
    publisher.schedule();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stays under ten frames a second while the selection moves a hundred times a second", () => {
    const publisher = createPresencePublisher(() => current, send, leave);
    for (let tick = 1; tick <= 500; tick += 1) {
      current = { path: "main.tex", cursor: tick, anchor: tick };
      publisher.schedule();
      vi.advanceTimersByTime(10);
    }
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    publisher.dispose();
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(30);
    expect(send.mock.calls.length).toBeLessThanOrEqual(5 * 10);
    expect(send).toHaveBeenLastCalledWith({ path: "main.tex", cursor: 500, anchor: 500 });
  });

  it("never sends a leave while the person stays visible", () => {
    const publisher = createPresencePublisher(() => current, send, leave);
    publisher.schedule();
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 2);
    publisher.dispose();
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("presence visibility", () => {
  let visibility: CollabPresence;
  const read = () => visiblePresence(current, visibility);

  beforeEach(() => {
    visibility = "cursor";
  });

  it("passes the cursor through, keeps only the file, or shares nothing", () => {
    const here = { path: "main.tex", cursor: 7, anchor: 3 };
    expect(visiblePresence(here, "cursor")).toEqual(here);
    expect(visiblePresence(here, "file")).toEqual({ path: "main.tex", cursor: null, anchor: null });
    expect(visiblePresence(here, "hidden")).toBeNull();
  });

  it("shares only the file, even while the cursor moves", () => {
    visibility = "file";
    const publisher = createPresencePublisher(read, send, leave);
    publisher.schedule();
    expect(send).toHaveBeenCalledWith({ path: "main.tex", cursor: null, anchor: null });
    current = { path: "main.tex", cursor: 40, anchor: 12 };
    publisher.schedule();
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ path: "main.tex", cursor: null, anchor: null });
    publisher.dispose();
  });

  it("sends nothing at all while hidden, not even a keep-alive or a leave", () => {
    visibility = "hidden";
    const publisher = createPresencePublisher(read, send, leave);
    publisher.schedule();
    current = { path: "intro.tex", cursor: 2, anchor: 2 };
    publisher.schedule();
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 3);
    publisher.dispose();
    expect(send).not.toHaveBeenCalled();
    expect(leave).not.toHaveBeenCalled();
  });

  it("tells the others once when the person hides mid-session, then goes quiet", () => {
    const publisher = createPresencePublisher(read, send, leave);
    publisher.schedule();
    expect(send).toHaveBeenCalledTimes(1);
    visibility = "hidden";
    publisher.schedule();
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    expect(leave).toHaveBeenCalledTimes(1);
    current = { path: "intro.tex", cursor: 5, anchor: 5 };
    publisher.schedule();
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS * 3);
    publisher.schedule();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    publisher.dispose();
  });

  it("comes back with the current place and keeps it alive after showing again", () => {
    const publisher = createPresencePublisher(read, send, leave);
    publisher.schedule();
    visibility = "hidden";
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    publisher.schedule();
    expect(leave).toHaveBeenCalledTimes(1);
    visibility = "cursor";
    vi.advanceTimersByTime(PRESENCE_INTERVAL_MS);
    publisher.schedule();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ path: "main.tex", cursor: 1, anchor: 1 });
    vi.advanceTimersByTime(PRESENCE_KEEP_ALIVE_MS);
    expect(send).toHaveBeenCalledTimes(3);
    publisher.dispose();
  });
});
