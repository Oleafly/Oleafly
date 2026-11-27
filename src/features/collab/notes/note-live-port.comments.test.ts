// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { type NoteLiveEditor, noteCommentSurface } from "@/lib/collab-live-bridge";
import { RemoteDocumentSession } from "../live/remote-session";
import { FakeChannel } from "../live/tests/fake-channel";
import { bindNoteLive, type NoteLiveDeps } from "./note-live-port";

const TEXT = "The encoder masks patches.\n";

function fakeEditor() {
  return {
    serialize: () => TEXT,
    show: vi.fn(),
    composing: () => false,
    selectionOffsets: () => ({ head: 0, anchor: 0 }),
    blockAt: () => 0,
    setPeerMarks: vi.fn(),
    setPeerCarets: vi.fn(),
    revealBlock: vi.fn(),
    onCaret: () => () => undefined,
    batch: (run: () => void) => run(),
    setComments: vi.fn(),
    commentDraft: vi.fn(() => ({ from: 4, to: 11 })),
    commentTarget: vi.fn(() => ({ from: 12, to: 17, quote: "masks" })),
    revealComment: vi.fn(() => true),
  } satisfies NoteLiveEditor;
}

const handles: { end(): void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.end();
});

function bind(editor: NoteLiveEditor) {
  const channel = new FakeChannel(TEXT);
  const deps: NoteLiveDeps = {
    transport: () => channel.transport(),
    presence: { set: vi.fn(async () => undefined), leave: vi.fn(async () => undefined) },
  };
  const handle = bindNoteLive(
    {
      noteId: "n1",
      path: "note.md",
      session: { projectId: "n1", role: "editor", accountId: "a1", deviceId: "d1" },
      editor,
      baseline: { text: TEXT, serialized: TEXT },
      onEnd: vi.fn(),
    },
    deps,
  );
  handles.push(handle);
  return handle;
}

describe("a live note's comment surface", () => {
  it("lets the comments store draw in the note, read its draft and selection, and reveal threads", () => {
    const editor = fakeEditor();
    bind(editor);
    const surface = noteCommentSurface("n1", "note.md");
    expect(surface).not.toBeNull();
    expect(noteCommentSurface("n1", "other.md")).toBeNull();
    expect(noteCommentSurface("n2")).toBeNull();
    const view = { spans: [{ id: "t1", from: 4, to: 11, resolved: false }], selected: "t1", draft: null };
    surface?.show(view);
    expect(editor.setComments).toHaveBeenLastCalledWith(view);
    expect(surface?.draft()).toEqual({ from: 4, to: 11 });
    expect(surface?.target()).toEqual({ from: 12, to: 17, quote: "masks" });
    expect(surface?.reveal("t1")).toBe(true);
    expect(() => surface?.flush()).not.toThrow();
    expect(surface?.session).toBeDefined();
  });

  it("goes away and clears the note's threads when the note stops being live", () => {
    const editor = fakeEditor();
    const handle = bind(editor);
    const surface = noteCommentSurface("n1", "note.md");
    handle.end();
    expect(noteCommentSurface("n1", "note.md")).toBeNull();
    expect(editor.setComments).toHaveBeenLastCalledWith({ spans: [], selected: null, draft: null });
    editor.setComments.mockClear();
    surface?.show({ spans: [{ id: "t1", from: 4, to: 11, resolved: false }], selected: null, draft: null });
    expect(editor.setComments).not.toHaveBeenCalled();
    expect(surface?.draft()).toBeNull();
    expect(surface?.target()).toBeNull();
    expect(surface?.reveal("t1")).toBe(false);
  });
});

describe("a note bound to the editor's live session", () => {
  async function bindShared(channel: FakeChannel) {
    const shared = new RemoteDocumentSession("note.md", TEXT, { transport: channel.transport() });
    await shared.open();
    const onEnd = vi.fn();
    const handle = bindNoteLive(
      {
        noteId: "n1",
        path: "note.md",
        session: { projectId: "n1", role: "editor", accountId: "a1", deviceId: "d1" },
        document: shared,
        editor: fakeEditor(),
        baseline: { text: TEXT, serialized: TEXT },
        onEnd,
      },
      { presence: { set: vi.fn(async () => undefined), leave: vi.fn(async () => undefined) } },
    );
    handles.push(handle);
    return { shared, onEnd };
  }

  it("ends the moment the session detaches, without waiting for typing or a file change", async () => {
    const channel = new FakeChannel(TEXT);
    const { shared, onEnd } = await bindShared(channel);
    expect(onEnd).not.toHaveBeenCalled();
    const id = channel.opens.at(-1) ?? "";
    channel.detach(id, "unknown_op");
    channel.deliverOne(id);
    expect(shared.phase).toBe("detached");
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "dropped" }));
    expect(noteCommentSurface("n1", "note.md")).toBeNull();
  });

  it("ends when the editor closes the session it shared", async () => {
    const { shared, onEnd } = await bindShared(new FakeChannel(TEXT));
    shared.close();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "dropped" }));
  });
});
