// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { collabEditorSlot, setCollabEditorExtension } from "./collab-slot";

const marker = Facet.define<string>();
const views: EditorView[] = [];

function view(): EditorView {
  const created = new EditorView({
    state: EditorState.create({ doc: "abc", extensions: collabEditorSlot() }),
    parent: document.body,
  });
  views.push(created);
  return created;
}

afterEach(() => {
  for (const created of views.splice(0)) created.destroy();
});

describe("collab editor slot", () => {
  it("stays empty until live editing fills it", () => {
    expect(view().state.facet(marker)).toEqual([]);
  });

  it("reconfigures open editors and starts new ones with the current extension", () => {
    const open = view();
    const release = setCollabEditorExtension(marker.of("live"));
    expect(open.state.facet(marker)).toEqual(["live"]);
    expect(view().state.facet(marker)).toEqual(["live"]);
    release();
    expect(open.state.facet(marker)).toEqual([]);
    expect(view().state.facet(marker)).toEqual([]);
  });

  it("leaves a newer extension in place when an older one is released", () => {
    const open = view();
    const releaseOld = setCollabEditorExtension(marker.of("old"));
    const releaseNew = setCollabEditorExtension(marker.of("new"));
    releaseOld();
    expect(open.state.facet(marker)).toEqual(["new"]);
    releaseNew();
    expect(open.state.facet(marker)).toEqual([]);
  });

  it("forgets editors that were destroyed", () => {
    const closed = view();
    closed.destroy();
    const release = setCollabEditorExtension(marker.of("live"));
    expect(closed.state.facet(marker)).toEqual([]);
    release();
  });
});
