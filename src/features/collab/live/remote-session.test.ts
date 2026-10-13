import { describe, expect, it, vi } from "vitest";
import type { RemoteChange, Utf16Edit } from "@oleafly/editor/document-session";
import type { CollabDocMessage, CollabDocOpened } from "@/lib/tauri";
import { TextOperation } from "./ot";
import { RemoteDocumentSession, type RemoteSessionTransport } from "./remote-session";
import { FakeChannel } from "./tests/fake-channel";

function applyEdits(text: string, edits: readonly Utf16Edit[]): string {
  let result = "";
  let position = 0;
  for (const edit of edits) {
    result += text.slice(position, edit.from) + edit.insert;
    position = edit.to;
  }
  return result + text.slice(position);
}

class Editor {
  doc: string;
  version: number;
  readonly changes: RemoteChange[] = [];

  constructor(readonly session: RemoteDocumentSession) {
    this.doc = session.text();
    this.version = session.version();
    session.subscribe((change) => {
      this.doc = applyEdits(this.doc, change.edits);
      this.version = change.version;
      this.changes.push(change);
    });
  }

  type(edits: Utf16Edit[]): void {
    this.session.applyLocal(edits, this.version);
    this.doc = applyEdits(this.doc, edits);
    this.version = this.session.version();
  }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function insertAt(position: number, text: string, length: number): TextOperation {
  return new TextOperation().retain(position).insert(text).retain(length - position);
}

async function opened(channel: FakeChannel, initial = channel.text, readOnly = () => false) {
  const onText = vi.fn();
  const session = new RemoteDocumentSession("main.tex", initial, {
    transport: channel.transport(),
    readOnly,
    onText,
  });
  const editor = new Editor(session);
  await session.open();
  return { session, editor, onText, id: channel.opens.at(-1) ?? "" };
}

describe("RemoteDocumentSession", () => {
  it("opens with the shared text and tells the editor what changed", async () => {
    const channel = new FakeChannel("hello world");
    const { session, editor, onText } = await opened(channel, "hello");
    expect(session.phase).toBe("open");
    expect(session.text()).toBe("hello world");
    expect(editor.doc).toBe("hello world");
    expect(editor.changes).toEqual([{ edits: [{ from: 5, to: 5, insert: " world" }], version: 1 }]);
    expect(onText).toHaveBeenLastCalledWith("hello world");
  });

  it("sends one change at a time and buffers the rest", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    editor.type([{ from: 4, to: 4, insert: "e" }]);
    editor.type([{ from: 0, to: 1, insert: "A" }]);
    expect(channel.sent).toEqual([{ client: id, rev: 0, op: [3, "d"] }]);
    expect(session.text()).toBe("Abcde");
    channel.receiveOne();
    channel.deliverOne(id);
    expect(channel.sent.at(-1)).toEqual({ client: id, rev: 1, op: ["A", -1, 3, "e"] });
    channel.drain();
    expect(channel.text).toBe("Abcde");
    expect(session.synchronized).toBe(true);
  });

  it("moves a remote change past its own pending changes", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 3, to: 3, insert: "!" }]);
    editor.type([{ from: 0, to: 0, insert: ">" }]);
    channel.remote(insertAt(1, "XY", 3));
    channel.deliverOne(id);
    expect(editor.changes.at(-1)?.edits).toEqual([{ from: 2, to: 2, insert: "XY" }]);
    expect(session.text()).toBe(">aXYbc!");
    channel.drain();
    expect(channel.text).toBe(">aXYbc!");
    expect(editor.doc).toBe(channel.text);
  });

  it("replaces the text and drops pending changes on reset", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 0, to: 0, insert: "x" }]);
    editor.type([{ from: 0, to: 0, insert: "y" }]);
    channel.reset("fresh");
    channel.deliverOne(id);
    expect(session.text()).toBe("fresh");
    expect(editor.doc).toBe("fresh");
    expect(session.synchronized).toBe(true);
    editor.type([{ from: 5, to: 5, insert: "!" }]);
    expect(channel.sent.at(-1)).toEqual({ client: id, rev: channel.rev, op: [5, "!"] });
  });

  it("reopens the document when its length disagrees with the channel", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    channel.text = "abcdef";
    channel.clients.get(id)?.outbox.push({ kind: "remote", rev: 1, op: [3], length: 6 });
    channel.deliverOne(id);
    await flush();
    expect(channel.closes).toEqual([id]);
    expect(channel.opens).toHaveLength(2);
    expect(session.text()).toBe("abcdef");
    expect(editor.doc).toBe("abcdef");
    expect(session.phase).toBe("open");
  });

  it("refuses local changes while read-only and from a stale version", async () => {
    const channel = new FakeChannel("abc");
    let viewer = true;
    const { session, editor } = await opened(channel, "abc", () => viewer);
    expect(session.readOnly).toBe(true);
    expect(() => session.applyLocal([{ from: 0, to: 0, insert: "x" }], session.version())).toThrow(/read-only/);
    viewer = false;
    expect(session.readOnly).toBe(false);
    expect(() => session.applyLocal([{ from: 0, to: 0, insert: "x" }], session.version() + 1)).toThrow(/version/);
    editor.type([{ from: 0, to: 0, insert: "x" }]);
    expect(session.text()).toBe("xabc");
  });

  it("keeps typing done while opening and moves it onto the shared text", async () => {
    const channel = new FakeChannel("shared text");
    let release: (value: CollabDocOpened | null) => void = () => {};
    const transport = channel.transport();
    const session = new RemoteDocumentSession("main.tex", "text", {
      transport: {
        ...transport,
        open: (path, onMessage) =>
          new Promise((resolve) => {
            release = (value) => resolve(value);
            void transport.open(path, onMessage);
          }),
      },
    });
    const editor = new Editor(session);
    const opening = session.open();
    expect(session.phase).toBe("opening");
    editor.type([{ from: 4, to: 4, insert: "!" }]);
    release({ file_id: "file-0", rev: channel.rev, text: channel.text });
    await opening;
    expect(editor.doc).toBe("shared text!");
    channel.drain();
    expect(channel.text).toBe("shared text!");
  });

  it("applies only the messages newer than the opened revision", async () => {
    const queued: CollabDocMessage[] = [];
    let deliver: (message: CollabDocMessage) => void = () => {};
    let release: (value: CollabDocOpened | null) => void = () => {};
    const transport: RemoteSessionTransport = {
      open: (_path, onMessage) => {
        deliver = onMessage;
        return new Promise((resolve) => (release = resolve));
      },
      change: vi.fn(),
      close: vi.fn(),
    };
    const session = new RemoteDocumentSession("main.tex", "", { transport });
    const opening = session.open();
    queued.push({ kind: "remote", rev: 2, op: ["a", 2], length: 3 });
    queued.push({ kind: "remote", rev: 3, op: [3, "b"], length: 4 });
    for (const message of queued) deliver(message);
    release({ file_id: "f", rev: 2, text: "xya" });
    await opening;
    expect(session.text()).toBe("xyab");
  });

  it("detaches when the file is not shared", async () => {
    const onPhase = vi.fn();
    const session = new RemoteDocumentSession("build/main.pdf", "local", {
      transport: { open: async () => null, change: vi.fn(), close: vi.fn() },
      onPhase,
    });
    await session.open();
    expect(session.phase).toBe("detached");
    expect(session.readOnly).toBe(true);
    expect(session.text()).toBe("local");
    expect(onPhase).toHaveBeenLastCalledWith("detached");
  });

  it("reports the channel revision it has applied", async () => {
    const channel = new FakeChannel("abc");
    channel.reset("abc");
    const { session, editor, id } = await opened(channel);
    expect(session.revision).toBe(1);
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    expect(session.revision).toBe(1);
    channel.drain();
    expect(session.revision).toBe(2);
    channel.remote(insertAt(0, "Z", 4));
    expect(session.revision).toBe(2);
    channel.deliverOne(id);
    expect(session.revision).toBe(3);
    channel.reset("fresh");
    channel.deliverOne(id);
    expect(session.revision).toBe(4);
  });

  it("resolves settled once every change is confirmed and closes its file", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 0, to: 0, insert: "x" }]);
    editor.type([{ from: 0, to: 0, insert: "y" }]);
    let settled = false;
    void session.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    channel.drain();
    await flush();
    expect(settled).toBe(true);
    session.close();
    expect(channel.closes).toEqual([id]);
    expect(session.phase).toBe("closed");
    expect(session.readOnly).toBe(true);
  });

  it("converges for two editors under random interleavings", async () => {
    let seed = 0x2545f491;
    const below = (bound: number) => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return bound <= 0 ? 0 : seed % bound;
    };
    const pieces = ["a", "b", "\n", "é", "😀"];
    for (let round = 0; round < 150; round += 1) {
      const channel = new FakeChannel("start😀\n");
      const left = await opened(channel);
      const right = await opened(channel);
      const editors = [left, right];
      for (let step = 0; step < 40; step += 1) {
        const pick = below(5);
        const target = editors[below(2)];
        if (pick < 2) {
          const characters = Array.from(target.editor.doc);
          const start = below(characters.length + 1);
          const end = Math.min(characters.length, start + below(3));
          const from = characters.slice(0, start).join("").length;
          const to = characters.slice(0, end).join("").length;
          target.editor.type([{ from, to, insert: below(2) === 0 ? pieces[below(pieces.length)] : "" }]);
        } else if (pick === 2) {
          channel.receiveOne();
        } else {
          channel.deliverOne(target.id);
        }
      }
      channel.drain();
      expect(left.editor.doc).toBe(channel.text);
      expect(right.editor.doc).toBe(channel.text);
      expect(left.session.text()).toBe(channel.text);
      expect(right.session.text()).toBe(channel.text);
    }
  });
});

describe("RemoteDocumentSession recovery", () => {
  function scripted(...answers: CollabDocOpened[]) {
    const listeners: ((message: CollabDocMessage) => void)[] = [];
    const transport = {
      open: vi.fn((_path: string, onMessage: (message: CollabDocMessage) => void) => {
        listeners.push(onMessage);
        return Promise.resolve<CollabDocOpened>(answers.shift() ?? { file_id: "again", rev: 9, text: "fresh" });
      }),
      change: vi.fn<RemoteSessionTransport["change"]>(),
      close: vi.fn(),
    };
    return { transport, listeners };
  }

  it("ignores an empty edit", async () => {
    const channel = new FakeChannel("abc");
    const { session, onText } = await opened(channel);
    onText.mockClear();
    session.applyLocal([], session.version());
    expect(session.version()).toBe(0);
    expect(channel.sent).toEqual([]);
    expect(onText).not.toHaveBeenCalled();
  });

  it("sends all the typing done while opening as one change", async () => {
    const channel = new FakeChannel("abc");
    let release: (value: CollabDocOpened | null) => void = () => {};
    const transport = channel.transport();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: {
        ...transport,
        open: (path, onMessage) =>
          new Promise((resolve) => {
            release = resolve;
            void transport.open(path, onMessage);
          }),
      },
    });
    const editor = new Editor(session);
    const opening = session.open();
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    editor.type([{ from: 0, to: 0, insert: ">" }]);
    release({ file_id: "file-0", rev: channel.rev, text: channel.text });
    await opening;
    expect(channel.sent).toEqual([{ client: "file-0", rev: 0, op: [">", 3, "d"] }]);
    channel.drain();
    expect(channel.text).toBe(">abcd");
  });

  it("sends nothing for typing while opening that the shared text already has", async () => {
    const channel = new FakeChannel("ac");
    let release: (value: CollabDocOpened | null) => void = () => {};
    const transport = channel.transport();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: {
        ...transport,
        open: (path, onMessage) =>
          new Promise((resolve) => {
            release = resolve;
            void transport.open(path, onMessage);
          }),
      },
    });
    const editor = new Editor(session);
    const opening = session.open();
    editor.type([{ from: 1, to: 2, insert: "" }]);
    release({ file_id: "file-0", rev: channel.rev, text: channel.text });
    await opening;
    expect(channel.sent).toEqual([]);
    expect(session.text()).toBe("ac");
    expect(session.synchronized).toBe(true);
  });

  it("stays closed once closed", async () => {
    const channel = new FakeChannel("abc");
    const { session, id } = await opened(channel);
    session.close();
    session.close();
    await session.open();
    expect(channel.closes).toEqual([id]);
    expect(channel.opens).toHaveLength(1);
    expect(session.phase).toBe("closed");
  });

  it("closes nothing when it was closed while a file that is not shared was opening", async () => {
    let release: (value: CollabDocOpened | null) => void = () => {};
    const close = vi.fn();
    const session = new RemoteDocumentSession("notes.txt", "local", {
      transport: { open: () => new Promise((resolve) => (release = resolve)), change: vi.fn(), close },
    });
    const opening = session.open();
    session.close();
    release(null);
    await opening;
    expect(close).not.toHaveBeenCalled();
    expect(session.phase).toBe("closed");
  });

  it("closes a file that finished opening after the session was closed, and is settled at once", async () => {
    let release: (value: CollabDocOpened | null) => void = () => {};
    const close = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: { open: () => new Promise((resolve) => (release = resolve)), change: vi.fn(), close },
    });
    const opening = session.open();
    session.close();
    release({ file_id: "late", rev: 0, text: "abc" });
    await opening;
    expect(close).toHaveBeenCalledExactlyOnceWith("late");
    let settled = false;
    void session.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(true);
  });

  it("ignores messages from a document it has opened again since", async () => {
    const { transport, listeners } = scripted(
      { file_id: "first", rev: 0, text: "abc" },
      { file_id: "second", rev: 0, text: "abc" },
    );
    const session = new RemoteDocumentSession("main.tex", "abc", { transport });
    await session.open();
    await session.open();
    listeners[0]({ kind: "remote", rev: 1, op: ["x", 3], length: 4 });
    expect(session.text()).toBe("abc");
    listeners[1]({ kind: "remote", rev: 1, op: ["x", 3], length: 4 });
    expect(session.text()).toBe("xabc");
  });

  it("stops replaying queued messages once one of them makes it reopen", async () => {
    let release: (value: CollabDocOpened | null) => void = () => {};
    let deliver: (message: CollabDocMessage) => void = () => {};
    const open = vi.fn((_path: string, onMessage: (message: CollabDocMessage) => void) => {
      if (open.mock.calls.length > 1) return Promise.resolve({ file_id: "again", rev: 9, text: "fresh" });
      deliver = onMessage;
      return new Promise<CollabDocOpened | null>((resolve) => (release = resolve));
    });
    const close = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "", { transport: { open, change: vi.fn(), close } });
    const opening = session.open();
    deliver({ kind: "remote", rev: 3, op: [3, "b"], length: 99 });
    deliver({ kind: "ack", rev: 4, length: 4 });
    release({ file_id: "first", rev: 2, text: "xya" });
    await opening;
    await flush();
    expect(close).toHaveBeenCalledExactlyOnceWith("first");
    expect(open).toHaveBeenCalledTimes(2);
    expect(session.text()).toBe("fresh");
    expect(session.phase).toBe("open");
  });

  it("reopens on a confirmation it was not waiting for", async () => {
    const channel = new FakeChannel("abc");
    const { session, id } = await opened(channel);
    channel.clients.get(id)?.outbox.push({ kind: "ack", rev: 1, length: 3 });
    channel.deliverOne(id);
    await flush();
    expect(channel.closes).toEqual([id]);
    expect(channel.opens).toHaveLength(2);
    expect(session.phase).toBe("open");
  });

  it("reopens when a confirmed change leaves the length out of step", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    channel.inbox.length = 0;
    channel.clients.get(id)?.outbox.push({ kind: "ack", rev: 1, length: 99 });
    channel.deliverOne(id);
    await flush();
    expect(channel.closes).toEqual([id]);
    expect(channel.opens).toHaveLength(2);
    expect(session.text()).toBe("abc");
  });

  it("reopens when sending a change fails", async () => {
    const { transport } = scripted(
      { file_id: "first", rev: 0, text: "abc" },
      { file_id: "second", rev: 1, text: "abcd" },
    );
    transport.change.mockRejectedValueOnce(new Error("gone"));
    const session = new RemoteDocumentSession("main.tex", "abc", { transport });
    const editor = new Editor(session);
    await session.open();
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    await flush();
    expect(transport.close).toHaveBeenCalledWith("first");
    expect(transport.open).toHaveBeenCalledTimes(2);
    expect(session.text()).toBe("abcd");
    expect(editor.doc).toBe("abcd");
  });

  it("stays closed when a change sent before closing fails afterwards", async () => {
    const { transport } = scripted({ file_id: "first", rev: 0, text: "abc" });
    let fail: (error: Error) => void = () => {};
    transport.change.mockReturnValueOnce(new Promise<void>((_, reject) => (fail = reject)));
    const session = new RemoteDocumentSession("main.tex", "abc", { transport });
    await session.open();
    session.applyLocal([{ from: 3, to: 3, insert: "d" }], session.version());
    session.close();
    fail(new Error("gone"));
    await flush();
    expect(transport.open).toHaveBeenCalledOnce();
    expect(session.phase).toBe("closed");
  });

  it("stays closed when a listener closes it while a bad change arrives", async () => {
    const channel = new FakeChannel("abc");
    const { session, id } = await opened(channel);
    session.subscribe(() => session.close());
    channel.clients.get(id)?.outbox.push({ kind: "remote", rev: 1, op: [3, "!"], length: 99 });
    channel.deliverOne(id);
    await flush();
    expect(channel.opens).toHaveLength(1);
    expect(session.phase).toBe("closed");
  });
});

