// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorSuggestions,
  SUGGESTION_STYLES,
  suggestionSpansIn,
  type EditorSuggestionsSource,
  type SuggestionSnapshot,
  type SuggestionSpan,
} from "./editor-suggestions";

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
