import type { CollabCommentThread } from "@oleafly/backend-port";
import { describe, expect, it } from "vitest";
import { FileOverlays, type OverlaySession, placement } from "./overlays";
import type { CollabSuggestion } from "./protocol";
import type { SessionEdit } from "./session";

class FakeSession implements OverlaySession {
  phase = "open";
  revision = 1;
  synchronized = true;
  shared: string;
  local: string;

  constructor(text: string) {
    this.shared = text;
    this.local = text;
  }

  confirmed(): string {
    return this.shared;
  }

  text(): string {
    return this.local;
  }
}

function suggestion(patch: Partial<CollabSuggestion>): CollabSuggestion {
  return {
    id: "s1",
    fileId: "f",
    kind: "insert",
    author: "alice",
    createdAt: 1,
    from: 0,
    to: 0,
    text: "",
    threadId: null,
    verified: true,
    ...patch,
  };
}

function thread(id: string, from: number, to: number, resolved = false): CollabCommentThread {
  return {
    id,
    fileId: "f",
    anchor: { quote: "", range: { from, to } },
    createdBy: "alice",
    createdAt: 1,
    resolved: resolved ? { by: "alice", at: 2, verified: true } : null,
    messages: [],
    verified: true,
  };
}

function edit(session: FakeSession, edits: SessionEdit["edits"], local: boolean): SessionEdit {
  const before = session.local;
  let after = "";
  let position = 0;
  for (const change of edits) {
    after += before.slice(position, change.from) + change.insert;
    position = change.to;
  }
  session.local = after + before.slice(position);
  return { edits, before, local };
}

describe("placement", () => {
  it("waits while the file is opening or the frame is ahead", () => {
    const session = new FakeSession("abc");
    session.phase = "opening";
    expect(placement(session, 1).kind).toBe("wait");
    session.phase = "open";
    expect(placement(session, 2).kind).toBe("wait");
  });

  it("places a current frame as is when nothing is unconfirmed", () => {
    const session = new FakeSession("abcdef");
    const place = placement(session, 1);
    expect(place.kind).toBe("place");
    if (place.kind !== "place") return;
    expect(place.exact).toBe(true);
    expect(place.map(4, 1)).toBe(4);
    expect(place.map(99, 1)).toBe(6);
  });

  it("moves a current frame past typing the server has not confirmed", () => {
    const session = new FakeSession("abcdef");
    session.synchronized = false;
    session.local = "XXabcdef";
    const place = placement(session, 1);
    if (place.kind !== "place") throw new Error("expected placement");
    expect(place.map(3, 1)).toBe(5);
    expect(place.unsent).not.toBeNull();
  });

  it("places an older frame as well as it can", () => {
    const session = new FakeSession("abc");
    session.revision = 5;
    const place = placement(session, 3);
    if (place.kind !== "place") throw new Error("expected placement");
    expect(place.exact).toBe(false);
    expect(place.map(10, 1)).toBe(3);
  });
});

describe("FileOverlays", () => {
  const options = (suggesting = false) => ({ self: () => "me", suggesting: () => suggesting });

  it("places suggestions and threads from frames", () => {
    const session = new FakeSession("Hello world");
    const overlays = new FileOverlays(session, options());
    overlays.setSuggestions(1, [
      suggestion({ id: "ins", kind: "insert", from: 6, to: 11, text: "world" }),
      suggestion({ id: "del", kind: "delete", from: 5, to: 5, text: " big" }),
    ]);
    overlays.setThreads(1, [thread("t1", 0, 5), thread("t2", 6, 11, true)]);
    const snapshot = overlays.snapshot();
    expect(snapshot.suggestions.map((entry) => [entry.id, entry.kind, entry.from, entry.to])).toEqual([
      ["ins", "insert", 6, 11],
      ["del", "delete", 5, 5],
    ]);
    expect(snapshot.threads).toEqual([
      { id: "t1", from: 0, to: 5, resolved: false },
      { id: "t2", from: 6, to: 11, resolved: true },
    ]);
  });

  it("holds a frame until the session reaches its revision", () => {
    const session = new FakeSession("abc");
    const overlays = new FileOverlays(session, options());
    overlays.setSuggestions(2, [suggestion({ from: 0, to: 2, text: "ab" })]);
    expect(overlays.snapshot().suggestions).toEqual([]);
    session.revision = 2;
    overlays.settle();
    expect(overlays.snapshot().suggestions).toHaveLength(1);
  });

  it("keeps ranges on their text through later edits and drops emptied insertions", () => {
    const session = new FakeSession("Hello world");
    const overlays = new FileOverlays(session, options());
    overlays.setSuggestions(1, [suggestion({ id: "ins", from: 6, to: 11, text: "world" })]);
    overlays.setThreads(1, [thread("t1", 0, 5)]);
    overlays.edit(edit(session, [{ from: 0, to: 0, insert: ">> " }], false));
    expect(overlays.snapshot().suggestions[0]).toMatchObject({ from: 9, to: 14 });
    expect(overlays.snapshot().threads[0]).toMatchObject({ from: 3, to: 8 });
    overlays.edit(edit(session, [{ from: 9, to: 14, insert: "" }], false));
    expect(overlays.snapshot().suggestions).toEqual([]);
  });

  it("shows local typing as a pending suggestion while suggesting", () => {
    const session = new FakeSession("abc");
    const overlays = new FileOverlays(session, options(true));
    overlays.edit(edit(session, [{ from: 1, to: 2, insert: "XY" }], true));
    expect(overlays.snapshot().suggestions).toEqual([
      expect.objectContaining({ kind: "delete", from: 1, to: 1, text: "b", pending: true, author: "me" }),
      expect.objectContaining({ kind: "insert", from: 1, to: 3, pending: true, author: "me" }),
    ]);
  });

  it("does not show local typing as a suggestion while editing", () => {
    const session = new FakeSession("abc");
    const overlays = new FileOverlays(session, options(false));
    overlays.edit(edit(session, [{ from: 1, to: 2, insert: "XY" }], true));
    expect(overlays.snapshot().suggestions).toEqual([]);
  });

  it("shrinks an own insertion instead of marking a deletion inside it", () => {
    const session = new FakeSession("abcNEWdef");
    const overlays = new FileOverlays(session, options(true));
    overlays.setSuggestions(1, [suggestion({ id: "mine", author: "me", from: 3, to: 6, text: "NEW" })]);
    overlays.edit(edit(session, [{ from: 4, to: 5, insert: "" }], true));
    const entries = overlays.snapshot().suggestions;
    expect(entries).toEqual([expect.objectContaining({ id: "mine", kind: "insert", from: 3, to: 5 })]);
  });

  it("marks only the part of a deletion outside an own insertion", () => {
    const session = new FakeSession("abcNEWdef");
    const overlays = new FileOverlays(session, options(true));
    overlays.setSuggestions(1, [suggestion({ id: "mine", author: "me", from: 3, to: 6, text: "NEW" })]);
    overlays.edit(edit(session, [{ from: 5, to: 8, insert: "" }], true));
    expect(overlays.snapshot().suggestions).toEqual([
      expect.objectContaining({ id: "mine", kind: "insert", from: 3, to: 5 }),
      expect.objectContaining({ kind: "delete", from: 5, text: "de", pending: true }),
    ]);
  });

  it("replaces pending suggestions once a frame covers all the typing", () => {
    const session = new FakeSession("abc");
    const overlays = new FileOverlays(session, options(true));
    session.synchronized = false;
    overlays.edit(edit(session, [{ from: 3, to: 3, insert: "d" }], true));
    expect(overlays.snapshot().suggestions).toHaveLength(1);
    session.shared = "abcd";
    session.revision = 2;
    session.synchronized = true;
    overlays.setSuggestions(2, [suggestion({ id: "srv", author: "me", from: 3, to: 4, text: "d" })]);
    expect(overlays.snapshot().suggestions).toEqual([expect.objectContaining({ id: "srv", pending: false })]);
  });

  it("rebuilds pending suggestions from the unconfirmed text when a frame arrives mid typing", () => {
    const session = new FakeSession("abc");
    const overlays = new FileOverlays(session, options(true));
    session.synchronized = false;
    overlays.edit(edit(session, [{ from: 3, to: 3, insert: "d" }], true));
    overlays.edit(edit(session, [{ from: 4, to: 4, insert: "e" }], true));
    session.shared = "abcd";
    session.revision = 2;
    overlays.setSuggestions(2, [suggestion({ id: "srv", author: "me", from: 3, to: 4, text: "d" })]);
    const entries = overlays.snapshot().suggestions;
    expect(entries).toEqual([
      expect.objectContaining({ id: "srv", from: 3, to: 4 }),
      expect.objectContaining({ pending: true, kind: "insert", from: 4, to: 5 }),
    ]);
  });

  it("keeps a draft comment range on its text", () => {
    const session = new FakeSession("Hello world");
    const overlays = new FileOverlays(session, options());
    overlays.setDraft({ from: 11, to: 6 });
    expect(overlays.snapshot().draft).toEqual({ from: 6, to: 11 });
    overlays.edit(edit(session, [{ from: 0, to: 0, insert: "Oh " }], false));
    expect(overlays.snapshot().draft).toEqual({ from: 9, to: 14 });
  });

  it("tells subscribers when anything moves", () => {
    const session = new FakeSession("abc");
    const overlays = new FileOverlays(session, options());
    let calls = 0;
    const stop = overlays.subscribe(() => {
      calls += 1;
    });
    overlays.setThreads(1, [thread("t", 0, 1)]);
    overlays.edit(edit(session, [{ from: 0, to: 0, insert: "x" }], false));
    stop();
    overlays.setDraft(null);
    expect(calls).toBeGreaterThanOrEqual(2);
    const seen = calls;
    overlays.setDraft({ from: 0, to: 1 });
    expect(calls).toBe(seen);
  });
});
