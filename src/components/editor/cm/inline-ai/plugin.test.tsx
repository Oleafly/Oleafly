// @vitest-environment jsdom
import { type ChangeSpec, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath } from "@oleafly/editor";
import { remoteChange } from "@oleafly/editor/collaboration";
import { act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInlineEditStore } from "@/store/inlineEdit";

vi.mock("./InlineEditPanel", () => ({
  InlineEditPanel: () => <div data-testid="inline-panel" />,
}));

import { acceptInlineEdit, inlineDiffPlugin, rejectInlineEdit } from "./plugin";

let view: EditorView;

function open(from: number, to: number, original: string) {
  act(() => useInlineEditStore.getState().open({ from, to, original }));
}

function update(patch: object) {
  act(() => {
    useInlineEditStore.setState((state) =>
      state.session ? { session: { ...state.session, ...patch } } : state,
    );
  });
}

beforeEach(() => {
  useInlineEditStore.getState().reset();
  view = new EditorView({
    state: EditorState.create({ doc: "hello world\nsecond line", extensions: inlineDiffPlugin }),
    parent: document.body,
  });
});

afterEach(() => {
  view.destroy();
  useInlineEditStore.getState().reset();
  setEditorDocumentPath(null);
});

function remote(changes: ChangeSpec) {
  act(() =>
    view.dispatch({
      changes,
      annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
      filter: false,
    }),
  );
}

function local(changes: ChangeSpec) {
  act(() => view.dispatch({ changes, userEvent: "input.type" }));
}

function session() {
  return useInlineEditStore.getState().session;
}

function marked(selector: string) {
  return [...view.contentDOM.querySelectorAll(selector)].map((node) => node.textContent);
}

describe("inline diff plugin", () => {
  it("mounts the prompt panel below the target line while a session is open", async () => {
    open(0, 5, "hello");
    const widget = view.dom.querySelector(".cm-inline-prompt");
    expect(widget).not.toBeNull();
    await waitFor(() => expect(widget?.querySelector("[data-testid='inline-panel']")).not.toBeNull());
    expect(widget?.previousElementSibling?.textContent).toBe("hello world");

    act(() => useInlineEditStore.getState().reset());
    expect(view.dom.querySelector(".cm-inline-prompt")).toBeNull();
    await waitFor(() => expect(widget?.childElementCount).toBe(0));
  });

  it("previews deletions and additions while streaming and reviewing", () => {
    open(0, 11, "hello world");
    update({ phase: "streaming", proposed: "hello there" });
    expect([...view.contentDOM.querySelectorAll(".cm-inline-del")].map((node) => node.textContent)).toEqual([
      "world",
    ]);
    expect([...view.contentDOM.querySelectorAll(".cm-inline-add")].map((node) => node.textContent)).toEqual([
      "there",
    ]);
    update({ phase: "reviewing" });
    expect(view.contentDOM.querySelectorAll(".cm-inline-del")).toHaveLength(1);
    expect(view.state.doc.toString()).toBe("hello world\nsecond line");
  });

  it("shows no diff before there is a proposal to compare", () => {
    open(0, 11, "hello world");
    update({ proposed: "hello there" });
    expect(view.contentDOM.querySelector(".cm-inline-del, .cm-inline-add")).toBeNull();
    update({ phase: "streaming", proposed: "" });
    expect(view.contentDOM.querySelector(".cm-inline-del, .cm-inline-add")).toBeNull();
  });

  it("skips diff spans that fall outside the document", () => {
    open(20, 40, "line text that is gone");
    update({ phase: "reviewing", proposed: "replacement" });
    expect(view.contentDOM.querySelector(".cm-inline-del")).toBeNull();
    expect(view.dom.querySelector(".cm-inline-prompt")).not.toBeNull();
  });

  it("stops repainting once the editor is destroyed", () => {
    view.destroy();
    expect(() => open(0, 5, "hello")).not.toThrow();
  });
});

describe("accepting and rejecting", () => {
  it("replaces the target range with the proposal and closes the session", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("hello there\nsecond line");
    expect(useInlineEditStore.getState().session).toBeNull();
  });

  it("does nothing to accept without a session", () => {
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("hello world\nsecond line");
  });

  it("closes the session on reject without changing the document", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    rejectInlineEdit(view);
    expect(view.state.doc.toString()).toBe("hello world\nsecond line");
    expect(useInlineEditStore.getState().session).toBeNull();
  });
});

describe("pending range under other people's edits", () => {
  it("follows a remote edit before it, so accept lands on the original text", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    remote({ from: 0, insert: "Oh, " });
    expect(session()).toMatchObject({ phase: "reviewing", from: 10, to: 15 });
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("Oh, hello there\nsecond line");
  });

  it("keeps the streamed preview on the mapped text", () => {
    open(6, 11, "world");
    update({ phase: "streaming", proposed: "there" });
    remote({ from: 0, insert: "Oh, " });
    update({ proposed: "there!" });
    expect(marked(".cm-inline-del")).toEqual(["world"]);
  });

  it("keeps the card under the target line when lines are added above it", () => {
    open(6, 11, "world");
    remote({ from: 0, insert: "one\ntwo\nthree\n" });
    update({ instruction: "Shorten" });
    expect(view.dom.querySelector(".cm-inline-prompt")?.previousElementSibling?.textContent).toBe(
      "hello world",
    );
  });

  it("keeps the card when someone deletes the lines below the target", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    remote({ from: 11, to: 23 });
    expect(session()).toMatchObject({ phase: "reviewing", from: 6, to: 11 });
    expect(view.dom.querySelector(".cm-inline-prompt")).not.toBeNull();
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("hello there");
  });

  it("ignores a remote edit after it", () => {
    open(0, 5, "hello");
    update({ phase: "reviewing", proposed: "HELLO" });
    remote({ from: 23, insert: "!!" });
    expect(session()).toMatchObject({ phase: "reviewing", from: 0, to: 5 });
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("HELLO world\nsecond line!!");
  });

  it("stays acceptable when someone types right at its edges", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    remote({ from: 6, insert: "big " });
    remote({ from: 15, insert: "!" });
    expect(session()).toMatchObject({ phase: "reviewing", from: 10, to: 15 });
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("hello big there!\nsecond line");
  });

  it.each([
    ["an insert inside it", { from: 8, insert: "x" }],
    ["a deletion that clips it", { from: 4, to: 7 }],
    ["a replacement of part of it", { from: 9, to: 11, insert: "LD" }],
  ])("withdraws the suggestion after %s", (_label, change) => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    remote(change);
    expect(session()?.phase).toBe("withdrawn");
    expect(view.contentDOM.querySelector(".cm-inline-del, .cm-inline-add")).toBeNull();
    expect(view.dom.querySelector(".cm-inline-prompt")).not.toBeNull();
    const before = view.state.doc.toString();
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe(before);
    expect(session()?.phase).toBe("withdrawn");
  });

  it.each(["prompting", "error"] as const)(
    "keeps the prompt open while %s when someone edits the text, and follows it",
    (phase) => {
      open(6, 11, "world");
      update({ phase, instruction: "Make it formal", error: phase === "error" ? "failed" : undefined });
      remote({ from: 8, insert: "x" });
      remote({ from: 0, insert: "Oh, " });
      expect(session()).toMatchObject({ phase, instruction: "Make it formal", from: 10, to: 16 });
    },
  );

  it("withdraws a suggestion that is still streaming", () => {
    open(6, 11, "world");
    update({ phase: "streaming", proposed: "the" });
    remote({ from: 8, to: 9 });
    expect(session()?.phase).toBe("withdrawn");
    act(() => useInlineEditStore.getState().appendProposed("there"));
    act(() => useInlineEditStore.getState().finishReviewing());
    expect(session()?.phase).toBe("withdrawn");
    expect(view.contentDOM.querySelector(".cm-inline-del, .cm-inline-add")).toBeNull();
  });

  it("keeps following the text after it is withdrawn", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    remote({ from: 8, insert: "x" });
    remote({ from: 0, insert: "Oh, " });
    expect(session()).toMatchObject({ phase: "withdrawn", from: 10, to: 16 });
  });

  it("maps several transactions applied in one update", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    const first = view.state.update({
      changes: { from: 0, insert: "Oh, " },
      annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
    });
    const second = first.state.update({ changes: { from: 0, insert: ">" } });
    act(() => view.update([first, second]));
    expect(session()).toMatchObject({ phase: "reviewing", from: 11, to: 16 });
  });
});

describe("pending range under local edits", () => {
  it("follows a local edit before it instead of applying against shifted text", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    local({ from: 0, insert: "Oh, " });
    expect(session()).toMatchObject({ phase: "reviewing", from: 10, to: 15 });
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("Oh, hello there\nsecond line");
  });

  it("keeps the suggestion acceptable after a local edit inside it", () => {
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    local({ from: 8, insert: "x" });
    expect(session()).toMatchObject({ phase: "reviewing", from: 6, to: 12 });
    acceptInlineEdit(view);
    expect(view.state.doc.toString()).toBe("hello there\nsecond line");
  });

  it("closes the suggestion when the editor moves to another file", () => {
    act(() => setEditorDocumentPath("main.tex"));
    open(6, 11, "world");
    update({ phase: "reviewing", proposed: "there" });
    act(() => setEditorDocumentPath("main.tex"));
    expect(session()?.phase).toBe("reviewing");
    act(() => setEditorDocumentPath("chapter.tex"));
    expect(session()).toBeNull();
  });
});
