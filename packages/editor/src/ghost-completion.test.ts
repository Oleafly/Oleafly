// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  autocompletion,
  completionStatus,
  moveCompletionSelection,
  startCompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import {
  acceptGhostCompletion,
  clearGhostCompletion,
  ghostCompletion,
  pendingGhostCompletion,
} from "./ghost-completion";

// A source that offers the given labels whenever a backslash command or word
// is being typed, mirroring how the real LaTeX sources behave.
function sourceOf(
  labels: Array<string | { label: string; boost?: number; apply?: unknown }>,
): CompletionSource {
  return (context) => {
    const match = context.matchBefore(/(\\[a-zA-Z@]*|[A-Za-z][A-Za-z0-9]*)$/);
    if (!match) return null;
    return {
      from: match.from,
      options: labels.map((entry) =>
        typeof entry === "string" ? { label: entry } : entry,
      ) as never,
    };
  };
}

// jsdom has no layout, but the ghost only needs the state field and the view
// plugin, both of which run headless.
function mount(
  doc: string,
  sources: CompletionSource[],
  selection = 0,
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions: [ghostCompletion(sources)],
    }),
    parent: document.body,
  });
  view.focus();
  return view;
}

function caretToEnd(view: EditorView) {
  view.dispatch({ selection: { anchor: view.state.doc.length } });
}

// The plugin recomputes in a microtask so it never dispatches mid-update.
const settle = () => new Promise((resolve) => queueMicrotask(() => resolve(null)));

describe("ghost completion suggestions", () => {
  it("does not materialize a large prose document for a non-trigger token", async () => {
    const doc = `${"ordinary prose ".repeat(100_000)}typing`;
    const source = vi.fn<CompletionSource>((context) => {
      context.state.doc.toString();
      return null;
    });
    const view = mount(doc, [source], doc.length);
    const sliceString = vi.spyOn(view.state.doc, "sliceString");
    const toString = vi.spyOn(view.state.doc, "toString");

    await settle();

    expect(source).not.toHaveBeenCalled();
    expect(toString).not.toHaveBeenCalled();
    expect(
      sliceString.mock.calls.every(([from = 0, to = view.state.doc.length]) =>
        to - from <= 2_048
      ),
    ).toBe(true);
    view.destroy();
  });

  it("offers the remainder of the best matching command", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha", "\\alphabet"])]);
    caretToEnd(view);
    await settle();
    // Ties on boost go to the shortest completion.
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("prefers a higher boost over a shorter label", async () => {
    const view = mount("\\alp", [
      sourceOf([
        { label: "\\alpha" },
        { label: "\\alphabetical", boost: 50 },
      ]),
    ]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("habetical");
    view.destroy();
  });

  it("stays quiet until enough characters are typed", async () => {
    const view = mount("\\a", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "l" } });
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("pha");
    view.destroy();
  });

  it("needs three characters after an at-reference trigger", async () => {
    const view = mount("@se", [sourceOf(["section"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "c" } });
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("tion");
    view.destroy();
  });

  it("previews the label even when apply is a guarded function", async () => {
    // Every real source wraps apply in a guard, so rejecting function applies
    // would silence the feature entirely. The label is what Tab inserts.
    const view = mount("\\sec", [
      sourceOf([{ label: "\\section", apply: () => undefined }]),
    ]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("tion");
    view.destroy();
  });

  it("previews a string apply rather than the label", async () => {
    const view = mount("\\ite", [
      sourceOf([{ label: "\\item", apply: "\\item " }]),
    ]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("m ");
    view.destroy();
  });

  it("does not suggest in the middle of a word", async () => {
    const view = mount("\\alpX", [sourceOf(["\\alpha"])]);
    view.dispatch({ selection: { anchor: 4 } });
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("suggests when a closing brace follows the cursor", async () => {
    const view = mount("{\\alp}", [sourceOf(["\\alpha"])]);
    view.dispatch({ selection: { anchor: 5 } });
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("stays quiet when nothing matches the typed prefix", async () => {
    const view = mount("\\zzz", [sourceOf(["\\alpha", "\\beta"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("ignores an exact match, which has nothing left to suggest", async () => {
    const view = mount("\\alpha", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("skips asynchronous sources and falls through to a sync one", async () => {
    const slow: CompletionSource = () => Promise.resolve(null);
    const view = mount("\\alp", [slow, sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("survives a source that throws", async () => {
    const broken: CompletionSource = () => {
      throw new Error("source failure");
    };
    const view = mount("\\alp", [broken, sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");
    view.destroy();
  });

  it("does not run a queued source after the editor is destroyed", async () => {
    const source = vi.fn(sourceOf(["\\alpha"]));
    const view = mount("\\alp", [source]);
    source.mockClear();

    view.destroy();
    await settle();

    expect(source).not.toHaveBeenCalled();
  });

  it("clears the suggestion when the selection is not empty", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");

    view.dispatch({ selection: { anchor: 0, head: 4 } });
    await settle();
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("tracks the highlighted option while the completion popup stays open", async () => {
    const source = sourceOf(["alpha", "alpine"]);
    const view = new EditorView({
      state: EditorState.create({
        doc: "alp",
        selection: { anchor: 3 },
        extensions: [
          ghostCompletion([source]),
          autocompletion({
            override: [source],
            activateOnTyping: false,
            interactionDelay: 0,
          }),
        ],
      }),
      parent: document.body,
    });

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");

    expect(moveCompletionSelection(true)(view)).toBe(true);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ine");
    view.destroy();
  });
});

describe("accepting and dismissing", () => {
  it("routes a Tab keydown through the editor keymap", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("\\alpha");
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("routes Tab to the highlighted completion while the popup is active", async () => {
    const source = sourceOf([
      { label: "\\alpha", apply: "\\alpha{}" },
      "\\alphabet",
    ]);
    const view = new EditorView({
      state: EditorState.create({
        doc: "\\alp",
        selection: { anchor: 4 },
        extensions: [
          ghostCompletion([source]),
          autocompletion({
            override: [source],
            activateOnTyping: false,
            interactionDelay: 0,
          }),
        ],
      }),
      parent: document.body,
    });
    view.focus();

    expect(startCompletion(view)).toBe(true);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha{}");

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    // The completion's apply value wins over its label, proving that Tab
    // delegates to CodeMirror instead of merely inserting the ghost text.
    expect(view.state.doc.toString()).toBe("\\alpha{}");
    expect(completionStatus(view.state)).toBeNull();
    view.destroy();
  });

  it("Tab inserts the suggestion and leaves the cursor after it", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(acceptGhostCompletion(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("\\alpha");
    expect(view.state.selection.main.head).toBe(6);
    expect(pendingGhostCompletion(view)).toBeNull();
    view.destroy();
  });

  it("declines when there is nothing to accept, so Tab keeps indenting", async () => {
    const view = mount("plain text", [sourceOf(["\\alpha"])]);
    view.dispatch({ selection: { anchor: 0 } });
    await settle();
    expect(acceptGhostCompletion(view)).toBe(false);
    expect(clearGhostCompletion(view)).toBe(false);
    view.destroy();
  });

  it("Escape dismisses without changing the document", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(clearGhostCompletion(view)).toBe(true);
    expect(pendingGhostCompletion(view)).toBeNull();
    expect(view.state.doc.toString()).toBe("\\alp");
    view.destroy();
  });

  it("renders the suggestion as a dim widget in the document", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    const widget = view.dom.querySelector(".cm-ghostCompletion");
    expect(widget?.textContent).toBe("ha");
    expect(widget?.getAttribute("aria-hidden")).toBe("true");
    view.destroy();
  });
});

describe("dismissal", () => {
  it("stays dismissed at the same cursor, and returns after the next edit", async () => {
    const view = mount("\\alp", [sourceOf(["\\alpha"])]);
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("ha");

    clearGhostCompletion(view);
    await settle();
    // Dismissing does not move the cursor, so without the dismissal memory the
    // very next recompute would offer the same candidate again.
    expect(pendingGhostCompletion(view)).toBeNull();

    view.dispatch({ changes: { from: view.state.doc.length, insert: "h" } });
    caretToEnd(view);
    await settle();
    expect(pendingGhostCompletion(view)).toBe("a");
    view.destroy();
  });
});
