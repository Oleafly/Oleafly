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
