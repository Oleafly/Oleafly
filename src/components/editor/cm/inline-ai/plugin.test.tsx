// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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
});

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
