// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { commentsEditorSlot, setCommentsEditorExtension } from "./comments-slot";
import { setSuggestionsEditorExtension, suggestionsEditorSlot } from "./suggestions-slot";

const marker = Facet.define<string>();
const views: EditorView[] = [];

function view(): EditorView {
  const created = new EditorView({
    state: EditorState.create({ doc: "abc", extensions: [commentsEditorSlot(), suggestionsEditorSlot()] }),
    parent: document.body,
  });
  views.push(created);
  return created;
}

afterEach(() => {
  for (const created of views.splice(0)) created.destroy();
});

describe("suggestions editor slot", () => {
  it("fills open and new editors and empties them on release", () => {
    const open = view();
    const release = setSuggestionsEditorExtension(marker.of("suggestions"));
    expect(open.state.facet(marker)).toEqual(["suggestions"]);
    expect(view().state.facet(marker)).toEqual(["suggestions"]);
    release();
    expect(open.state.facet(marker)).toEqual([]);
  });

  it("sits beside comments without either replacing the other", () => {
    const open = view();
    const releaseComments = setCommentsEditorExtension(marker.of("comments"));
    const releaseSuggestions = setSuggestionsEditorExtension(marker.of("suggestions"));
    expect([...open.state.facet(marker)].sort()).toEqual(["comments", "suggestions"]);
    releaseComments();
    expect(open.state.facet(marker)).toEqual(["suggestions"]);
    releaseSuggestions();
    expect(open.state.facet(marker)).toEqual([]);
  });

  it("keeps a newer extension when an older one is released", () => {
    const open = view();
    const releaseOld = setSuggestionsEditorExtension(marker.of("old"));
    const releaseNew = setSuggestionsEditorExtension(marker.of("new"));
    releaseOld();
    expect(open.state.facet(marker)).toEqual(["new"]);
    releaseNew();
    expect(open.state.facet(marker)).toEqual([]);
  });
});
