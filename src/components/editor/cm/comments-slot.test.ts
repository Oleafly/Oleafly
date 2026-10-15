// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { collabEditorSlot, setCollabEditorExtension } from "./collab-slot";
import { commentsEditorSlot, setCommentsEditorExtension } from "./comments-slot";

const marker = Facet.define<string>();
const views: EditorView[] = [];

function view(): EditorView {
  const created = new EditorView({
    state: EditorState.create({ doc: "abc", extensions: [collabEditorSlot(), commentsEditorSlot()] }),
    parent: document.body,
  });
  views.push(created);
  return created;
}

afterEach(() => {
  for (const created of views.splice(0)) created.destroy();
});

describe("comments editor slot", () => {
  it("fills open and new editors and empties them on release", () => {
    const open = view();
    expect(open.state.facet(marker)).toEqual([]);
    const release = setCommentsEditorExtension(marker.of("comments"));
    expect(open.state.facet(marker)).toEqual(["comments"]);
    expect(view().state.facet(marker)).toEqual(["comments"]);
    release();
    expect(open.state.facet(marker)).toEqual([]);
  });

  it("sits beside live editing without either replacing the other", () => {
    const open = view();
    const releaseLive = setCollabEditorExtension(marker.of("live"));
    const releaseComments = setCommentsEditorExtension(marker.of("comments"));
    expect([...open.state.facet(marker)].sort()).toEqual(["comments", "live"]);
    releaseLive();
    expect(open.state.facet(marker)).toEqual(["comments"]);
    releaseComments();
    expect(open.state.facet(marker)).toEqual([]);
  });

  it("keeps a newer extension when an older one is released and forgets destroyed editors", () => {
    const open = view();
    const releaseOld = setCommentsEditorExtension(marker.of("old"));
    const releaseNew = setCommentsEditorExtension(marker.of("new"));
    releaseOld();
    expect(open.state.facet(marker)).toEqual(["new"]);
    open.destroy();
    releaseNew();
    expect(open.state.facet(marker)).toEqual(["new"]);
  });
});
