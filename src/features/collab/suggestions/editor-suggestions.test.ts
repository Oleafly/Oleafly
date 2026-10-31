// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorSuggestions,
  revealSuggestion,
  SUGGESTION_STYLES,
  suggestionSpansIn,
  type EditorSuggestionsSource,
  type SuggestionSnapshot,
  type SuggestionSpan,
} from "./editor-suggestions";

const mocks = vi.hoisted(() => ({ scroll: vi.fn() }));

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  scrollEditorPositionLocally: mocks.scroll,
}));

const DOC = "The quick brown fox jumps.";

class Source implements EditorSuggestionsSource {
  path: string | null = "intro.tex";
  state: SuggestionSnapshot = { path: "intro.tex", spans: [], active: null };
  readonly listeners = new Set<() => void>();
  readonly open = vi.fn();
  readonly hover = vi.fn();

  snapshot(): SuggestionSnapshot {
    return this.state;
  }

  documentPath(): string | null {
    return this.path;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(next: Partial<SuggestionSnapshot>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

const views: EditorView[] = [];

function editor(source: Source, doc = DOC): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: editorSuggestions(source) }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

async function tick(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

const quick: SuggestionSpan = {
  id: "s-quick",
  kind: "insert",
  from: 4,
  to: 10,
  text: "quick ",
  hue: 200,
  label: "Bob suggested adding this",
};
const lazy: SuggestionSpan = {
  id: "s-lazy",
  kind: "delete",
  from: 16,
  to: 16,
  text: "lazy ",
  hue: 30,
  label: "Carol suggested deleting this",
};

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  mocks.scroll.mockClear();
});

describe("suggestions in the editor", () => {
  it("tints inserted text in the author's colour and shows deleted text struck through at its anchor", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    const inserted = view.contentDOM.querySelector<HTMLElement>(".cm-suggestion-insert");
    expect(inserted?.textContent).toBe("quick ");
    expect(inserted?.getAttribute("data-suggestion-id")).toBe("s-quick");
    expect(inserted?.getAttribute("style")).toContain("--suggestion-hue: 200");
    expect(inserted?.getAttribute("title")).toBe("Bob suggested adding this");
    const deleted = view.contentDOM.querySelector<HTMLElement>(".cm-suggestion-delete");
    expect(deleted?.tagName).toBe("DEL");
    expect(deleted?.textContent).toBe("lazy ");
    expect(deleted?.style.getPropertyValue("--suggestion-hue")).toBe("30");
    expect(view.state.doc.toString()).toBe(DOC);
    const line = view.contentDOM.querySelector(".cm-line")?.textContent;
    expect(line).toBe("The quick brown lazy fox jumps.");
  });

  it("never draws an outline or a ring", () => {
    for (const style of Object.values(SUGGESTION_STYLES)) {
      expect(Object.keys(style)).not.toContain("outline");
      expect(Object.keys(style)).not.toContain("boxShadow");
    }
  });

  it("marks only the open file and clears when the list empties", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    source.path = "other.tex";
    const view = editor(source);
    await tick();
    expect(view.contentDOM.querySelector(".cm-suggestion-insert")).toBeNull();
    source.path = "intro.tex";
    source.set({ spans: [quick] });
    await tick();
    source.set({ spans: [quick, lazy] });
    await tick();
    expect(view.contentDOM.querySelectorAll(".cm-suggestion-insert, .cm-suggestion-delete")).toHaveLength(2);
    source.set({ spans: [] });
    await tick();
    expect(view.contentDOM.querySelectorAll(".cm-suggestion-insert, .cm-suggestion-delete")).toHaveLength(0);
  });

  it("keeps marks on their text through edits until the server reports new places", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    view.dispatch({ changes: { from: 0, insert: "Title. " } });
    expect(suggestionSpansIn(view.state).map(({ id, from, to }) => ({ id, from, to }))).toEqual([
      { id: "s-quick", from: 11, to: 17 },
      { id: "s-lazy", from: 23, to: 23 },
    ]);
    source.set({ spans: [quick, lazy] });
    await tick();
    expect(suggestionSpansIn(view.state)[0]).toMatchObject({ from: 11, to: 17 });
    source.set({ spans: [{ ...quick, from: 11, to: 18 }] });
    await tick();
    expect(suggestionSpansIn(view.state)).toEqual([{ ...quick, from: 11, to: 18 }]);
  });

  it("leaves text typed right after an insertion or at a deletion outside them, as the shared document does", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    view.dispatch({ changes: [{ from: 10, insert: "very " }] });
    view.dispatch({ changes: [{ from: 21, insert: "old " }] });
    expect(suggestionSpansIn(view.state).map(({ id, from, to }) => ({ id, from, to }))).toEqual([
      { id: "s-quick", from: 4, to: 10 },
      { id: "s-lazy", from: 25, to: 25 },
    ]);
    source.set({ spans: [quick, { ...lazy, from: 25, to: 25 }] });
    await tick();
    expect(view.contentDOM.querySelector(".cm-suggestion-insert")?.textContent).toBe("quick ");
  });

  it("gives the active suggestion a stronger tint", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy], active: "s-lazy" };
    const view = editor(source);
    await tick();
    expect(view.contentDOM.querySelector(".cm-suggestion-delete")?.classList).toContain("cm-suggestion-active");
    expect(view.contentDOM.querySelector(".cm-suggestion-insert")?.classList).not.toContain("cm-suggestion-active");
    source.set({ active: "s-quick" });
    await tick();
    expect(view.contentDOM.querySelector(".cm-suggestion-insert")?.classList).toContain("cm-suggestion-active");
  });

  it("opens the card on a click and follows the pointer for hover", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick, lazy] };
    const view = editor(source);
    await tick();
    const inserted = view.contentDOM.querySelector(".cm-suggestion-insert");
    inserted?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(source.hover).toHaveBeenLastCalledWith("s-quick");
    view.contentDOM.querySelector(".cm-suggestion-delete")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(source.hover).toHaveBeenLastCalledWith("s-lazy");
    view.contentDOM.querySelector(".cm-line")?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(source.hover).toHaveBeenLastCalledWith(null);
    inserted?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(source.open).toHaveBeenLastCalledWith("s-quick");
    view.contentDOM.querySelector(".cm-suggestion-delete")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(source.open).toHaveBeenLastCalledWith("s-lazy");
    inserted?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, metaKey: true }));
    expect(source.open).toHaveBeenCalledTimes(2);
  });
});

describe("reported places and pointer edge cases", () => {
  it("puts places the server reports outside the text at the nearest edge and draws nothing for empty ones", async () => {
    const source = new Source();
    source.state = {
      ...source.state,
      spans: [
        { ...quick, id: "nan", from: Number.NaN, to: 3 },
        { ...quick, id: "empty", from: 5, to: 5 },
        { ...lazy, id: "blank", text: "" },
        { ...quick, id: "far", from: 20, to: 99 },
      ],
    };
    const view = editor(source);
    await tick();
    expect(suggestionSpansIn(view.state).map(({ id, from, to }) => ({ id, from, to }))).toEqual([
      { id: "nan", from: 0, to: 3 },
      { id: "empty", from: 5, to: 5 },
      { id: "blank", from: 16, to: 16 },
      { id: "far", from: 20, to: DOC.length },
    ]);
    const drawn = [...view.contentDOM.querySelectorAll<HTMLElement>("[data-suggestion-id]")].map(
      (node) => node.dataset.suggestionId,
    );
    expect(drawn).toEqual(["nan", "far"]);
  });

  it("leaves its marks alone when only the selection moves or another feature updates the editor", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    const before = suggestionSpansIn(view.state);
    view.dispatch({ selection: { anchor: 2 } });
    expect(suggestionSpansIn(view.state)).toBe(before);
    const unrelated = StateEffect.define<number>();
    view.dispatch({ effects: unrelated.of(1) });
    expect(suggestionSpansIn(view.state)).toBe(before);
  });

  it("redraws once for a burst of updates and not at all after the editor closes", async () => {
    const source = new Source();
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: editorSuggestions(source) }),
      parent: document.body,
    });
    await tick();
    const dispatch = vi.spyOn(view, "dispatch");
    source.set({});
    await tick();
    expect(dispatch).not.toHaveBeenCalled();
    source.set({ spans: [quick] });
    source.set({ spans: [quick, lazy] });
    await tick();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(suggestionSpansIn(view.state).map((span) => span.id)).toEqual(["s-quick", "s-lazy"]);
    source.set({ active: "s-quick" });
    view.destroy();
    await tick();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(source.listeners.size).toBe(0);
  });

  it("reports each hover once and clears it when the pointer leaves the editor or moves onto plain text", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    const inserted = view.contentDOM.querySelector(".cm-suggestion-insert");
    inserted?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    inserted?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(source.hover).toHaveBeenCalledTimes(1);
    view.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    expect(source.hover).toHaveBeenLastCalledWith(null);
    view.contentDOM.dispatchEvent(new MouseEvent("mouseleave"));
    expect(source.hover).toHaveBeenCalledTimes(2);
    inserted?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(source.hover).toHaveBeenLastCalledWith("s-quick");
    const text = view.contentDOM.querySelector(".cm-line")?.firstChild;
    expect(text?.nodeType).toBe(Node.TEXT_NODE);
    text?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(source.hover).toHaveBeenLastCalledWith(null);
    expect(source.hover).toHaveBeenCalledTimes(4);
  });

  it("opens nothing for a click on plain text, one that ends a text selection, or one with a modifier or another button", async () => {
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    const marked = () => view.contentDOM.querySelector(".cm-suggestion-insert");
    marked()?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 2 }));
    marked()?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, shiftKey: true }));
    view.contentDOM.querySelector(".cm-line")?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    view.dispatch({ selection: { anchor: 4, head: 10 } });
    marked()?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(source.open).not.toHaveBeenCalled();
  });

  it("finds nothing in an editor without suggestions and reveals only a suggestion it shows", async () => {
    expect(suggestionSpansIn(EditorState.create({ doc: DOC }))).toEqual([]);
    const source = new Source();
    source.state = { ...source.state, spans: [quick] };
    const view = editor(source);
    await tick();
    expect(revealSuggestion(view, "s-missing")).toBe(false);
    expect(mocks.scroll).not.toHaveBeenCalled();
    expect(revealSuggestion(view, "s-quick")).toBe(true);
    expect(mocks.scroll).toHaveBeenCalledWith(view, 4);
  });
});
