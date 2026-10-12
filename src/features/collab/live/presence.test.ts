import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPresencePublisher,
  PRESENCE_INTERVAL_MS,
  PRESENCE_KEEP_ALIVE_MS,
  type Presence,
} from "./presence";

let current: Presence;
const send = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  current = { path: "main.tex", cursor: 1, anchor: 1 };
  send.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("presence publisher", () => {
  it("sends at most once per 150 ms and always the latest selection", () => {
    expect(PRESENCE_INTERVAL_MS).toBe(150);
    const publisher = createPresencePublisher(() => current, send);
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
    const publisher = createPresencePublisher(() => current, send);
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
    const publisher = createPresencePublisher(() => current, send);
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
    const publisher = createPresencePublisher(() => current, send);
    publisher.schedule();
    current = { path: "b.tex", cursor: 0, anchor: 0 };
    publisher.schedule();
    publisher.dispose();
    vi.advanceTimersByTime(500);
    publisher.schedule();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stays under ten frames a second while the selection moves a hundred times a second", () => {
    const publisher = createPresencePublisher(() => current, send);
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
});
