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

  it("sends only the committed text of an input method composition, as one change", async () => {
    const channel = new FakeChannel("ab");
    const { session, editor, id } = await opened(channel);
    session.holdLocal();
    editor.type([{ from: 2, to: 2, insert: "n" }]);
    editor.type([{ from: 2, to: 3, insert: "ni" }]);
    editor.type([{ from: 2, to: 4, insert: "nih" }]);
    editor.type([{ from: 2, to: 5, insert: "你好" }]);
    expect(channel.sent).toEqual([]);
    expect(session.text()).toBe("ab你好");
    expect(session.synchronized).toBe(false);
    session.releaseLocal();
    expect(channel.sent).toEqual([{ client: id, rev: 0, op: [2, "你好"] }]);
    channel.drain();
    expect(channel.text).toBe("ab你好");
    expect(session.synchronized).toBe(true);
  });

  it("keeps a composition when a collaborator types while it is held with nothing in flight", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    session.holdLocal();
    editor.type([{ from: 3, to: 3, insert: "n" }]);
    channel.remote(insertAt(0, "X", 3));
    channel.deliverOne(id);
    expect(session.text()).toBe("Xabcn");
    expect(editor.doc).toBe("Xabcn");
    editor.type([{ from: 4, to: 5, insert: "你" }]);
    session.releaseLocal();
    channel.drain();
    expect(channel.text).toBe("Xabc你");
    expect(session.text()).toBe(channel.text);
    expect(editor.doc).toBe(channel.text);
    expect(session.synchronized).toBe(true);
    expect(channel.opens).toHaveLength(1);
  });

  it("keeps a composition through an answer to earlier typing and a remote change that follows it", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 3, to: 3, insert: "!" }]);
    session.holdLocal();
    editor.type([{ from: 0, to: 0, insert: "k" }]);
    channel.receiveOne();
    channel.deliverOne(id);
    channel.remote(insertAt(4, "Z", 4));
    channel.deliverOne(id);
    expect(session.text()).toBe("kabc!Z");
    expect(channel.sent).toHaveLength(1);
    session.releaseLocal();
    channel.drain();
    expect(channel.text).toBe("kabc!Z");
    expect(editor.doc).toBe(channel.text);
    expect(session.synchronized).toBe(true);
    expect(channel.opens).toHaveLength(1);
  });

  it("moves a composition that kept the text's length past a remote change", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    session.holdLocal();
    editor.type([{ from: 1, to: 2, insert: "ば" }]);
    channel.remote(insertAt(2, "Y", 3));
    channel.deliverOne(id);
    expect(session.text()).toBe("aばYc");
    session.releaseLocal();
    channel.drain();
    expect(channel.text).toBe("aばYc");
    expect(editor.doc).toBe(channel.text);
    expect(channel.opens).toHaveLength(1);
  });

  it("keeps a composition waiting through an answer to earlier typing and remote changes", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 3, to: 3, insert: "!" }]);
    session.holdLocal();
    editor.type([{ from: 0, to: 0, insert: "k" }]);
    channel.remote(insertAt(1, "X", 3));
    channel.drain();
    expect(channel.sent).toEqual([{ client: id, rev: 0, op: [3, "!"] }]);
    editor.type([{ from: 0, to: 1, insert: "か" }]);
    expect(channel.sent).toHaveLength(1);
    session.releaseLocal();
    channel.drain();
    expect(channel.text).toBe("かaXbc!");
    expect(editor.doc).toBe(channel.text);
    expect(session.synchronized).toBe(true);
  });

  it("keeps typing made while opening where it was, when the shared text differs at both ends", async () => {
    const lines = Array.from({ length: 10 }, (_, index) => `line ${index}\n`).join("");
    const shared = lines.replace("line 0\n", "line 0 EDITED-BY-BOB\n").replace("line 9\n", "line 9 EDITED-BY-BOB\n");
    const channel = new FakeChannel(shared);
    const transport = channel.transport();
    let answer: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => (answer = resolve));
    const session = new RemoteDocumentSession("main.tex", lines, {
      transport: {
        ...transport,
        open: async (path, onMessage) => {
          await ready;
          return transport.open(path, onMessage);
        },
      },
    });
    const editor = new Editor(session);
    const opening = session.open();
    const afterFive = lines.indexOf("line 5") + "line 5".length;
    editor.type([{ from: afterFive, to: afterFive, insert: "Q" }]);
    answer();
    await opening;
    expect(session.text()).toBe(shared.replace("line 5\n", "line 5Q\n"));
    expect(editor.doc).toBe(session.text());
    const touched = editor.changes.flatMap((change) => change.edits);
    expect(touched.every((edit) => edit.to <= lines.indexOf("line 1") || edit.from >= lines.indexOf("line 9"))).toBe(
      true,
    );
    channel.drain();
    expect(channel.text).toBe(session.text());
  });

  it("copies its text once for a remote edit and not again when typing is confirmed", async () => {
    let deliver: (message: CollabDocMessage) => void = () => undefined;
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: {
        open: async (_path, onMessage) => {
          deliver = onMessage;
          return { file_id: "file", rev: 0, text: "abc", session: 1 };
        },
        change: vi.fn(),
        close: vi.fn(),
      },
    });
    await session.open();
    const apply = vi.spyOn(TextOperation.prototype, "apply");
    deliver({ kind: "remote", rev: 1, op: [">", 3], length: 4 });
    expect(apply).toHaveBeenCalledTimes(1);
    session.applyLocal([{ from: 4, to: 4, insert: "!" }], session.version());
    deliver({ kind: "ack", rev: 2, length: 5 });
    expect(apply).toHaveBeenCalledTimes(2);
    session.applyLocal([{ from: 5, to: 5, insert: "?" }], session.version());
    session.applyLocal([{ from: 6, to: 6, insert: "#" }], session.version());
    deliver({ kind: "remote", rev: 3, op: ["<", 5], length: 6 });
    deliver({ kind: "ack", rev: 4, length: 7 });
    deliver({ kind: "ack", rev: 5, length: 8 });
    expect(apply).toHaveBeenCalledTimes(5);
    expect(session.text()).toBe("<>abc!?#");
    expect(session.confirmed()).toBe("<>abc!?#");
    expect(session.synchronized).toBe(true);
    apply.mockRestore();
  });

  it("tells move listeners its new path when its file is renamed, and only then", async () => {
    const channel = new FakeChannel("abc");
    const { session } = await opened(channel);
    const moved = vi.fn();
    const stop = session.subscribeMove(moved);
    session.moveTo("main.tex");
    session.moveTo("chapters/main.tex");
    expect(moved).toHaveBeenCalledExactlyOnceWith("chapters/main.tex");
    stop();
    session.moveTo("main.tex");
    expect(moved).toHaveBeenCalledOnce();
    expect(session.path).toBe("main.tex");
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

  it("replaces the text on a reset when nothing of its own is waiting", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    channel.reset("fresh");
    channel.deliverOne(id);
    expect(session.text()).toBe("fresh");
    expect(editor.doc).toBe("fresh");
    expect(session.synchronized).toBe(true);
    editor.type([{ from: 5, to: 5, insert: "!" }]);
    expect(channel.sent.at(-1)).toEqual({ client: id, rev: channel.rev, op: [5, "!"] });
  });

  it("keeps typing in flight when the shared document resets, and sends it once on the reset text", async () => {
    const channel = new FakeChannel("abc");
    const discarded = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: channel.transport(),
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    await session.open();
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    editor.type([{ from: 4, to: 4, insert: "e" }]);
    channel.reset(">abc");
    channel.drain();
    expect(channel.text).toBe(">abcde");
    expect(session.text()).toBe(">abcde");
    expect(editor.doc).toBe(">abcde");
    expect(discarded).not.toHaveBeenCalled();
    expect(session.synchronized).toBe(true);
    expect(channel.opens).toHaveLength(1);
  });

  it("keeps a composition held when the shared document resets", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    session.holdLocal();
    editor.type([{ from: 3, to: 3, insert: "か" }]);
    channel.reset(">abc");
    channel.deliverOne(id);
    expect(session.text()).toBe(">abcか");
    expect(channel.sent).toEqual([]);
    session.releaseLocal();
    channel.drain();
    expect(channel.text).toBe(">abcか");
    expect(editor.doc).toBe(channel.text);
  });

  it("keeps a composition through two resets and sends it once when it ends", async () => {
    const channel = new FakeChannel("abc");
    const discarded = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: channel.transport(),
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    await session.open();
    const id = channel.opens[0];
    session.holdLocal();
    editor.type([{ from: 3, to: 3, insert: "か" }]);
    channel.reset(">abc");
    channel.deliverOne(id);
    channel.reset(">>abc");
    channel.deliverOne(id);
    expect(session.text()).toBe(">>abcか");
    expect(channel.sent).toEqual([]);
    session.releaseLocal();
    channel.drain();
    expect(channel.sent).toHaveLength(1);
    expect(channel.text).toBe(">>abcか");
    expect(editor.doc).toBe(channel.text);
    expect(discarded).not.toHaveBeenCalled();
    expect(channel.opens).toHaveLength(1);
  });

  // Only a broken state can leave typing that doesn't fit, so these two set it
  // up directly. The session must open again and say the typing was lost.
  it("opens again with the shared text when its unsent typing can't be kept, and says so", async () => {
    const channel = new FakeChannel("abc");
    const discarded = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: channel.transport(),
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    await session.open();
    const id = channel.opens[0];
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    editor.type([{ from: 4, to: 4, insert: "e" }]);
    (session as unknown as { buffer: TextOperation }).buffer = new TextOperation().retain(9).insert("?");
    channel.clients.get(id)?.onMessage({ kind: "remote", rev: 1, op: ["?"], length: 1 });
    await flush();
    expect(session.phase).toBe("open");
    expect(channel.opens).toHaveLength(2);
    expect(session.text()).toBe("abc");
    expect(editor.doc).toBe("abc");
    expect(discarded).toHaveBeenCalledWith("refused");
  });

  it("says so when typing made while opening no longer fits, and takes the shared text", async () => {
    const channel = new FakeChannel("shared");
    const transport = channel.transport();
    let answer: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => (answer = resolve));
    const discarded = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "local", {
      transport: {
        ...transport,
        open: async (path, onMessage) => {
          await ready;
          return transport.open(path, onMessage);
        },
      },
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    const opening = session.open();
    editor.type([{ from: 5, to: 5, insert: "!" }]);
    (session as unknown as { base: string }).base = "a text the typing wasn't made on";
    answer();
    await opening;
    expect(session.text()).toBe("shared");
    expect(editor.doc).toBe("shared");
    expect(discarded).toHaveBeenCalledWith("refused");
  });

  it("keeps typing the shared document refused once and sends it again on top of the reset text", async () => {
    const channel = new FakeChannel("abc");
    const discarded = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: channel.transport(),
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    await session.open();
    const id = channel.opens[0];
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    editor.type([{ from: 4, to: 4, insert: "e" }]);
    channel.refuseChanges = true;
    channel.remote(insertAt(0, ">", 3));
    channel.receiveOne();
    channel.refuseChanges = false;
    channel.drain();
    expect(channel.text).toBe(">abcde");
    expect(session.text()).toBe(">abcde");
    expect(editor.doc).toBe(">abcde");
    expect(session.synchronized).toBe(true);
    expect(discarded).not.toHaveBeenCalled();
    expect(channel.sent.at(-1)?.client).toBe(id);
  });

  it("drops typing the shared document refuses twice, and says so", async () => {
    const channel = new FakeChannel("abc");
    const discarded = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: channel.transport(),
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    await session.open();
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    channel.refuseChanges = true;
    channel.drain();
    expect(discarded).toHaveBeenCalledExactlyOnceWith("refused");
    expect(session.text()).toBe("abc");
    expect(editor.doc).toBe("abc");
    expect(session.synchronized).toBe(true);
  });

  it("drops typing it can no longer send once the person can only view, and says so", async () => {
    const channel = new FakeChannel("abc");
    const discarded = vi.fn();
    let viewer = false;
    const session = new RemoteDocumentSession("main.tex", "abc", {
      transport: channel.transport(),
      readOnly: () => viewer,
      onDiscarded: discarded,
    });
    const editor = new Editor(session);
    await session.open();
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    viewer = true;
    channel.refuseChanges = true;
    channel.receiveOne();
    channel.deliverOne(channel.opens[0]);
    expect(discarded).toHaveBeenCalledExactlyOnceWith("read_only");
    expect(session.text()).toBe("abc");
    expect(channel.inbox).toHaveLength(0);
  });

  it("keeps typing that wasn't confirmed through a reopen, moved past remote changes", async () => {
    const channel = new FakeChannel("abc");
    const { session, editor, id } = await opened(channel);
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    editor.type([{ from: 4, to: 4, insert: "e" }]);
    channel.inbox.length = 0;
    channel.remote(insertAt(0, ">", 3));
    const outbox = channel.clients.get(id)?.outbox ?? [];
    outbox[0] = { ...outbox[0], length: 99 } as CollabDocMessage;
    channel.deliverOne(id);
    await flush();
    channel.drain();
    expect(channel.opens).toHaveLength(2);
    expect(channel.text).toBe(">abcde");
    expect(session.text()).toBe(">abcde");
    expect(editor.doc).toBe(">abcde");
  });

  it("closes each channel with the token its open returned", async () => {
    const channel = new FakeChannel("abc");
    const { session, id } = await opened(channel);
    channel.clients.get(id)?.outbox.push({ kind: "ack", rev: 1, length: 3 });
    channel.deliverOne(id);
    await flush();
    session.close();
    expect(channel.closes).toEqual([id, channel.opens[1]]);
    expect(channel.closeTokens).toEqual([1, 2]);
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
    release({ file_id: "file-0", rev: channel.rev, text: channel.text, session: 1 });
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
    release({ file_id: "f", rev: 2, text: "xya", session: 2 });
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

  it("converges for two editors that compose with an input method and see resets, under random interleavings", async () => {
    let seed = 0x1b873593;
    const below = (bound: number) => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return bound <= 0 ? 0 : seed % bound;
    };
    const pieces = ["a", "\n", "你", "好", "か", "😀", "ば"];
    for (let round = 0; round < 200; round += 1) {
      const channel = new FakeChannel("start😀\n");
      const left = await opened(channel);
      const right = await opened(channel);
      const editors = [left, right];
      for (let step = 0; step < 60; step += 1) {
        const pick = below(12);
        const target = editors[below(2)];
        if (pick < 4) {
          const characters = Array.from(target.editor.doc);
          const start = below(characters.length + 1);
          const end = Math.min(characters.length, start + below(3));
          const from = characters.slice(0, start).join("").length;
          const to = characters.slice(0, end).join("").length;
          target.editor.type([{ from, to, insert: below(3) === 0 ? "" : pieces[below(pieces.length)] }]);
        } else if (pick < 6) {
          channel.receiveOne();
        } else if (pick < 9) {
          channel.deliverOne(target.id);
        } else if (pick === 9) {
          target.session.holdLocal();
        } else if (pick === 10) {
          target.session.releaseLocal();
        } else if (below(4) === 0) {
          channel.reset(channel.text);
        }
      }
      for (const { session } of editors) session.releaseLocal();
      channel.drain();
      expect(channel.opens).toHaveLength(2);
      for (const { session, editor } of editors) {
        expect(editor.doc).toBe(channel.text);
        expect(session.text()).toBe(channel.text);
        expect(session.synchronized).toBe(true);
      }
    }
  });
});

describe("RemoteDocumentSession recovery", () => {
  function scripted(...answers: CollabDocOpened[]) {
    const listeners: ((message: CollabDocMessage) => void)[] = [];
    const transport = {
      open: vi.fn((_path: string, onMessage: (message: CollabDocMessage) => void) => {
        listeners.push(onMessage);
        return Promise.resolve<CollabDocOpened>(answers.shift() ?? { file_id: "again", rev: 9, text: "fresh", session: 3 });
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
    release({ file_id: "file-0", rev: channel.rev, text: channel.text, session: 4 });
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
    release({ file_id: "file-0", rev: channel.rev, text: channel.text, session: 5 });
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
    release({ file_id: "late", rev: 0, text: "abc", session: 6 });
    await opening;
    expect(close).toHaveBeenCalledExactlyOnceWith("late", 6);
    let settled = false;
    void session.settled().then(() => (settled = true));
    await flush();
    expect(settled).toBe(true);
  });

  it("ignores messages from a document it has opened again since", async () => {
    const { transport, listeners } = scripted(
      { file_id: "first", rev: 0, text: "abc", session: 7 },
      { file_id: "second", rev: 0, text: "abc", session: 8 },
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
      if (open.mock.calls.length > 1) return Promise.resolve({ file_id: "again", rev: 9, text: "fresh", session: 9 });
      deliver = onMessage;
      return new Promise<CollabDocOpened | null>((resolve) => (release = resolve));
    });
    const close = vi.fn();
    const session = new RemoteDocumentSession("main.tex", "", { transport: { open, change: vi.fn(), close } });
    const opening = session.open();
    deliver({ kind: "remote", rev: 3, op: [3, "b"], length: 99 });
    deliver({ kind: "ack", rev: 4, length: 4 });
    release({ file_id: "first", rev: 2, text: "xya", session: 10 });
    await opening;
    await flush();
    expect(close).toHaveBeenCalledExactlyOnceWith("first", 10);
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

  it("reopens when sending a change fails, and sends the change again", async () => {
    const { transport } = scripted(
      { file_id: "first", rev: 0, text: "abc", session: 11 },
      { file_id: "second", rev: 1, text: "Xabc", session: 12 },
    );
    transport.change.mockRejectedValueOnce(new Error("gone"));
    const session = new RemoteDocumentSession("main.tex", "abc", { transport });
    const editor = new Editor(session);
    await session.open();
    editor.type([{ from: 3, to: 3, insert: "d" }]);
    await flush();
    expect(transport.close).toHaveBeenCalledWith("first", 11);
    expect(transport.open).toHaveBeenCalledTimes(2);
    expect(session.text()).toBe("Xabcd");
    expect(editor.doc).toBe("Xabcd");
    expect(transport.change).toHaveBeenLastCalledWith("second", 1, [4, "d"]);
  });

  it("stays closed when a change sent before closing fails afterwards", async () => {
    const { transport } = scripted({ file_id: "first", rev: 0, text: "abc", session: 13 });
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

