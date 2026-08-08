import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import {
  gateCompletionSource,
  isCompletionLexicallyTriggered,
} from "./completion-trigger";

function triggered(source: string, path: string): boolean {
  const state = EditorState.create({ doc: source });
  return isCompletionLexicallyTriggered(state, state.doc.length, path);
}

describe("completion lexical triggers", () => {
  it.each([
    ["main.tex", "\\alp"],
    ["main.tex", "\\begin{ite"],
    ["main.tex", "/sec"],
    ["main.md", "[Jump](#intro"],
    ["main.md", "See @knuth"],
    ["main.typ", "See @knuth"],
    ["main.typ", "#cite(<knuth"],
    ["main.typ", "#ref(<intro"],
    ["references.bib", "crossref = {knuth"],
  ])("recognizes a trigger in %s: %s", (path, source) => {
    expect(triggered(source, path)).toBe(true);
  });

  it.each(["main.tex", "main.md", "main.typ", "references.bib"])(
    "rejects an ordinary prose token in %s",
    (path) => {
      expect(triggered("ordinary prose typing", path)).toBe(false);
    },
  );

  it("allows explicit completion without a lexical trigger", () => {
    const state = EditorState.create({ doc: "ordinary prose" });
    const source = vi.fn(() => null);
    const gated = gateCompletionSource(source, "main.typ");

    gated(new CompletionContext(state, state.doc.length, true));

    expect(source).toHaveBeenCalledOnce();
  });

  it("does not invoke a gated source for automatic prose completion", () => {
    const state = EditorState.create({ doc: "ordinary prose typing" });
    const source = vi.fn(() => null);
    const gated = gateCompletionSource(source, "main.typ");

    gated(new CompletionContext(state, state.doc.length, false));

    expect(source).not.toHaveBeenCalled();
  });
});
