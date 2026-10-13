import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollabDocOpened } from "@/lib/tauri";
import { LiveSessions, type LiveSessionsOptions } from "./live-sessions";
import { FakeChannel } from "./tests/fake-channel";

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function options(channel: FakeChannel, overrides: Partial<LiveSessionsOptions> = {}): LiveSessionsOptions {
  return {
    transport: channel.transport(),
    readOnly: () => false,
    initialText: (path) => (path === "missing.tex" ? null : channel.text),
    mirror: vi.fn(),
    detached: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LiveSessions", () => {
  it("opens one session per text file and reuses it", async () => {
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel));
    const first = sessions.documentSession("main.tex");
    expect(first).not.toBeNull();
    expect(sessions.documentSession("main.tex")).toBe(first);
    expect(sessions.documentSession("figure.png")).toBeNull();
    expect(sessions.documentSession("missing.tex")).toBeNull();
    await flush();
    expect(channel.opens).toHaveLength(1);
    expect(first?.text()).toBe("abc");
  });

  it("mirrors text changes back to the caller", async () => {
    const channel = new FakeChannel("abc");
    const mirror = vi.fn();
    const sessions = new LiveSessions(options(channel, { mirror }));
    const session = sessions.documentSession("main.tex");
    await flush();
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    expect(mirror).toHaveBeenLastCalledWith("main.tex", "abc!");
  });

  it("brings the files store up to date when an open session is reused", async () => {
    const channel = new FakeChannel("abc");
    const mirror = vi.fn();
    const sessions = new LiveSessions(options(channel, { mirror }));
    sessions.documentSession("main.tex");
    await flush();
    mirror.mockClear();
    sessions.documentSession("main.tex");
    expect(mirror).toHaveBeenCalledWith("main.tex", "abc");
  });

  it("hands a file that is not shared back to local editing, with any typing", async () => {
    let release: (value: CollabDocOpened | null) => void = () => {};
    const detached = vi.fn();
    const sessions = new LiveSessions({
      transport: { open: () => new Promise((resolve) => (release = resolve)), change: vi.fn(), close: vi.fn() },
      readOnly: () => false,
      initialText: () => "local",
      mirror: vi.fn(),
      detached,
    });
    const session = sessions.documentSession("notes.txt");
    session?.applyLocal([{ from: 5, to: 5, insert: "!" }], session.version());
    release(null);
    await flush();
    expect(detached).toHaveBeenCalledWith("notes.txt", "local!", true);
    expect(sessions.documentSession("notes.txt")).toBeNull();
  });

  it("waits for confirmed changes before writing them out", async () => {
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel));
    const session = sessions.documentSession("main.tex");
    await flush();
    session?.applyLocal([{ from: 0, to: 0, insert: "x" }], session.version());
    const write = vi.fn(async () => {});
    const flushing = sessions.flush(write);
    await flush();
    expect(write).not.toHaveBeenCalled();
    channel.drain();
    await flushing;
    expect(write).toHaveBeenCalledOnce();
  });

  it("writes anyway when a change is never confirmed", async () => {
    vi.useFakeTimers();
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel, { settleTimeoutMs: 100 }));
    const session = sessions.documentSession("main.tex");
    await flush();
    session?.applyLocal([{ from: 0, to: 0, insert: "x" }], session.version());
    const write = vi.fn(async () => {});
    const flushing = sessions.flush(write);
    await vi.advanceTimersByTimeAsync(100);
    await flushing;
    expect(write).toHaveBeenCalledOnce();
  });

  it("keeps one open document when its file or folder moves, with typing still in flight", async () => {
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel));
    const session = sessions.documentSession("sections/results.tex");
    const other = sessions.documentSession("sections-old.tex");
    await flush();
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    sessions.move("sections", "parts");
    expect(sessions.documentSession("parts/results.tex")).toBe(session);
    expect(session?.path).toBe("parts/results.tex");
    expect(sessions.documentSession("sections-old.tex")).toBe(other);
    session?.applyLocal([{ from: 4, to: 4, insert: "?" }], session.version());
    await flush();
    expect(channel.opens).toHaveLength(2);
    expect(channel.closes).toEqual([]);
    expect(session?.text()).toBe("abc!?");
  });

  it("lets go of a deleted file's document only after its typing reached the shared project", async () => {
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel));
    const session = sessions.documentSession("sections/results.tex");
    await flush();
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    sessions.forget("sections");
    await flush();
    expect(session?.phase).toBe("open");
    channel.drain();
    await flush();
    expect(channel.text).toBe("abc!");
    expect(session?.phase).toBe("closed");
    const fresh = sessions.documentSession("sections/results.tex");
    expect(fresh).not.toBe(session);
  });

  it("closes every file and opens nothing more once closed", async () => {
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel));
    const session = sessions.documentSession("main.tex");
    await flush();
    sessions.close();
    expect(channel.closes).toEqual(channel.opens);
    expect(session?.phase).toBe("closed");
    expect(sessions.documentSession("main.tex")).toBeNull();
  });
});
