import { ChangeSet, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { changesToUtf16Edits, remoteChange } from "./collaboration";
import { LocalDocumentSession } from "./document-session";

describe("changesToUtf16Edits", () => {
  it("lists each change against the text before it, in order", () => {
    const state = EditorState.create({ doc: "hello world" });
    const transaction = state.update({
      changes: [
        { from: 11, insert: "!" },
        { from: 0, to: 5, insert: "HELLO" },
      ],
    });
    const edits = changesToUtf16Edits(transaction.changes);
    expect(edits).toEqual([
      { from: 0, to: 5, insert: "HELLO" },
      { from: 11, to: 11, insert: "!" },
    ]);
    const session = new LocalDocumentSession("main.tex", "hello world");
    session.applyLocal(edits, 0);
    expect(session.text()).toBe(transaction.state.doc.toString());
  });

  it("returns no edits for a change set that changes nothing", () => {
    expect(changesToUtf16Edits(ChangeSet.empty(5))).toEqual([]);
  });

  it("keeps an emoji whole when typing next to it or deleting it", () => {
    const state = EditorState.create({ doc: "a😀b" });
    const typed = state.update({ changes: { from: 3, insert: "x" } });
    expect(changesToUtf16Edits(typed.changes)).toEqual([{ from: 3, to: 3, insert: "x" }]);
    const deleted = typed.state.update({ changes: { from: 1, to: 3 } });
    expect(changesToUtf16Edits(deleted.changes)).toEqual([{ from: 1, to: 3, insert: "" }]);
    const session = new LocalDocumentSession("main.tex", "a😀b");
    session.applyLocal(changesToUtf16Edits(typed.changes), 0);
    session.applyLocal(changesToUtf16Edits(deleted.changes), 1);
    expect(session.text()).toBe(deleted.state.doc.toString());
  });

  it("reports inserted line breaks as LF, the way the editor stores them", () => {
    const state = EditorState.create({ doc: "one\ntwo" });
    const pasted = state.update({ changes: { from: 3, insert: "\r\nmiddle" } });
    expect(changesToUtf16Edits(pasted.changes)).toEqual([{ from: 3, to: 3, insert: "\nmiddle" }]);
    const session = new LocalDocumentSession("main.tex", "one\r\ntwo");
    session.applyLocal(changesToUtf16Edits(pasted.changes), 0);
    expect(session.text()).toBe(pasted.state.doc.toString());
  });
});

describe("remoteChange", () => {
  it("marks only the transactions that carry it", () => {
    const state = EditorState.create({ doc: "a" });
    expect(state.update({ annotations: remoteChange.of(true) }).annotation(remoteChange)).toBe(true);
    expect(state.update({}).annotation(remoteChange)).toBeUndefined();
  });
});
