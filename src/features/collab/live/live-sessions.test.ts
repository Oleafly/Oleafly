import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollabDocOpened } from "@/lib/tauri";
import { LiveSessions, type LiveSessionsOptions } from "./live-sessions";
import type { RemoteSessionTransport } from "./remote-session";
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

  it("holds only the files it has a shared document for, without opening one to check", async () => {
    const channel = new FakeChannel("abc");
    const sessions = new LiveSessions(options(channel));
    expect(sessions.holds("main.tex")).toBe(false);
    sessions.documentSession("main.tex");
    expect(sessions.holds("main.tex")).toBe(true);
    expect(sessions.holds("intro.tex")).toBe(false);
    await flush();
    expect(channel.opens).toHaveLength(1);
    sessions.close();
    expect(sessions.holds("main.tex")).toBe(false);
  });

  it("stops holding a file that turns out not to be shared", async () => {
    const sessions = new LiveSessions({
      transport: { open: async () => null, change: vi.fn(), close: vi.fn() },
      readOnly: () => false,
      initialText: () => "local",
      mirror: vi.fn(),
      detached: vi.fn(),
    });
    sessions.documentSession("notes.txt");
    await flush();
    expect(sessions.holds("notes.txt")).toBe(false);
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

describe("LiveSessions with files kept local", () => {
  function unshared(detached = vi.fn()) {
    const open = vi.fn(async (): Promise<CollabDocOpened | null> => null);
    const sessions = new LiveSessions({
      transport: { open, change: vi.fn(), close: vi.fn() },
      readOnly: () => false,
      initialText: () => "local",
      mirror: vi.fn(),
      detached,
    });
    return { sessions, open, detached };
  }

  it("keeps a local file local when it moves, and only that file", async () => {
    const { sessions, open } = unshared();
    sessions.documentSession("notes/a.txt");
    sessions.documentSession("todo.txt");
    await flush();
    sessions.move("notes", "archive");
    expect(sessions.documentSession("archive/a.txt")).toBeNull();
    expect(sessions.documentSession("todo.txt")).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
    expect(sessions.documentSession("notes/a.txt")).not.toBeNull();
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("forgets only the deleted path, local or shared", async () => {
    const channel = new FakeChannel("abc");
    const local = new Set(["notes/a.txt", "todo.txt"]);
    const transport = channel.transport();
    const open: RemoteSessionTransport["open"] = (path, onMessage) =>
      local.has(path) ? Promise.resolve(null) : transport.open(path, onMessage);
    const sessions = new LiveSessions(options(channel, { transport: { ...transport, open } }));
    sessions.documentSession("notes/a.txt");
    sessions.documentSession("todo.txt");
    const kept = sessions.documentSession("main.tex");
    const gone = sessions.documentSession("notes/b.tex");
    await flush();
    sessions.forget("notes");
    await flush();
    expect(gone?.phase).toBe("closed");
    expect(kept?.phase).toBe("open");
    expect(sessions.documentSession("main.tex")).toBe(kept);
    expect(sessions.documentSession("todo.txt")).toBeNull();
    local.delete("notes/a.txt");
    const fresh = sessions.documentSession("notes/a.txt");
    expect(fresh).not.toBeNull();
    await flush();
    expect(fresh?.phase).toBe("open");
  });

  it("does not hand back a deleted file whose document then turns out not to be shared", async () => {
    let fail: (error: Error) => void = () => {};
    const open = vi.fn(async (): Promise<CollabDocOpened | null> => null);
    open.mockResolvedValueOnce({ file_id: "notes", rev: 0, text: "abc" });
    const detached = vi.fn();
    const sessions = new LiveSessions({
      transport: { open, change: () => new Promise<void>((_, reject) => (fail = reject)), close: vi.fn() },
      readOnly: () => false,
      initialText: () => "abc",
      mirror: vi.fn(),
      detached,
    });
    const session = sessions.documentSession("notes.tex");
    await flush();
    session?.applyLocal([{ from: 3, to: 3, insert: "!" }], session.version());
    sessions.forget("notes.tex");
    fail(new Error("gone"));
    await flush();
    expect(open).toHaveBeenCalledTimes(2);
    expect(detached).not.toHaveBeenCalled();
    expect(session?.phase).toBe("closed");
  });
});

