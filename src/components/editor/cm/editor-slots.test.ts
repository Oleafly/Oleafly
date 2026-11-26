// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  collabEditorSlot,
  commentsEditorSlot,
  setCollabEditorExtension,
  setCommentsEditorExtension,
  setSuggestionsEditorExtension,
  suggestionsEditorSlot,
} from "./editor-slots";

const marker = Facet.define<string>();
const views: EditorView[] = [];

function view(): EditorView {
  const created = new EditorView({
    state: EditorState.create({
      doc: "abc",
      extensions: [collabEditorSlot(), commentsEditorSlot(), suggestionsEditorSlot()],
    }),
    parent: document.body,
  });
  views.push(created);
  return created;
}

afterEach(() => {
  for (const created of views.splice(0)) created.destroy();
});

const SLOTS = [
  ["live editing", setCollabEditorExtension],
  ["comments", setCommentsEditorExtension],
  ["suggestions", setSuggestionsEditorExtension],
] as const;

describe.each(SLOTS)("the %s editor slot", (_name, set) => {
  it("stays empty until it is filled, then fills open and new editors and empties them on release", () => {
    const open = view();
    expect(open.state.facet(marker)).toEqual([]);
    const release = set(marker.of("filled"));
    expect(open.state.facet(marker)).toEqual(["filled"]);
    expect(view().state.facet(marker)).toEqual(["filled"]);
    release();
    expect(open.state.facet(marker)).toEqual([]);
    expect(view().state.facet(marker)).toEqual([]);
  });

  it("keeps a newer extension when an older one is released and forgets destroyed editors", () => {
    const open = view();
    const releaseOld = set(marker.of("old"));
    const releaseNew = set(marker.of("new"));
    releaseOld();
    expect(open.state.facet(marker)).toEqual(["new"]);
    open.destroy();
    releaseNew();
    expect(open.state.facet(marker)).toEqual(["new"]);
  });
});

describe("the editor slots together", () => {
  it("sit side by side without one replacing another", () => {
    const open = view();
    const releaseLive = setCollabEditorExtension(marker.of("live"));
    const releaseComments = setCommentsEditorExtension(marker.of("comments"));
    const releaseSuggestions = setSuggestionsEditorExtension(marker.of("suggestions"));
    expect([...open.state.facet(marker)].sort()).toEqual(["comments", "live", "suggestions"]);
    releaseLive();
    expect([...open.state.facet(marker)].sort()).toEqual(["comments", "suggestions"]);
    releaseComments();
    expect(open.state.facet(marker)).toEqual(["suggestions"]);
    releaseSuggestions();
    expect(open.state.facet(marker)).toEqual([]);
  });
});
