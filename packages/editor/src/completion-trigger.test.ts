import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import {
  gateCompletionSource,
  isCompletionLexicallyTriggered,
} from "./completion-trigger";

function triggered(source: string, syntax: "latex" | "markdown" | "typst" | "bibtex"): boolean {
  const state = EditorState.create({ doc: source });
  return isCompletionLexicallyTriggered(state, state.doc.length, syntax);
}

describe("completion lexical triggers", () => {
  it.each([
    ["latex", "\\alp"],
    ["latex", "\\begin{ite"],
    ["latex", "/sec"],
    ["markdown", "[Jump](#intro"],
    ["markdown", "See @knuth"],
    ["typst", "See @knuth"],
    ["typst", "#cite(<knuth"],
    ["typst", "#ref(<intro"],
    ["bibtex", "crossref = {knuth"],
  ] as const)("recognizes a trigger in %s: %s", (syntax, source) => {
    expect(triggered(source, syntax)).toBe(true);
  });

  it.each(["latex", "markdown", "typst", "bibtex"] as const)(
    "rejects an ordinary prose token in %s",
    (syntax) => {
      expect(triggered("ordinary prose typing", syntax)).toBe(false);
    },
  );

  it("allows explicit completion without a lexical trigger", () => {
    const state = EditorState.create({ doc: "ordinary prose" });
    const source = vi.fn(() => null);
    const gated = gateCompletionSource(source, "typst");

    gated(new CompletionContext(state, state.doc.length, true));

    expect(source).toHaveBeenCalledOnce();
  });

  it("does not invoke a gated source for automatic prose completion", () => {
    const state = EditorState.create({ doc: "ordinary prose typing" });
    const source = vi.fn(() => null);
    const gated = gateCompletionSource(source, "typst");

    gated(new CompletionContext(state, state.doc.length, false));

    expect(source).not.toHaveBeenCalled();
  });
});
