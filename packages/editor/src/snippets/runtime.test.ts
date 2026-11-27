// @vitest-environment jsdom

import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { latexLanguage } from "../latex";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { loadedSnippetRuntime } from "./loader";
import { snippetEditorExtensions, snippetRuntime } from "./runtime";
import { input, portWith, press } from "./tests/editor";
import { FAST_MATH_ENTRIES, PAPER_ENTRIES, SLASH_ENTRIES } from "./tests/fixtures";

stubRangeGeometry();

beforeAll(() => installEnglishEditorMessages());

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

function editor(doc: string): EditorView {
  const port = portWith({ ...SLASH_ENTRIES, ...FAST_MATH_ENTRIES, "paper.theorem": PAPER_ENTRIES["paper.theorem"] });
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [latexLanguage(), snippetEditorExtensions(port)],
    }),
  });
  return view;
}

describe("the snippet runtime", () => {
  it("hands itself to the loader as soon as it is imported", () => {
    expect(loadedSnippetRuntime()).toBe(snippetRuntime);
  });
});

describe("snippetEditorExtensions", () => {
  it("gives a standalone editor the list, Tab triggers, hints and typing", async () => {
    const math = editor("$x $");
    math.dispatch({ selection: EditorSelection.cursor(3) });
    input(math, "/");
    input(math, "/");
    expect(math.state.doc.toString()).toBe("$x \\frac{}{}$");

    const text = editor("thm");
    expect(press(text, "Tab")).toBe(true);
    expect(text.state.doc.toString()).toBe("\\begin{theorem}\n  \n\\end{theorem}");

    const slash = editor("/sec");
    startCompletion(slash);
    await vi.waitFor(() => expect(completionStatus(slash.state)).toBe("active"));
    expect(currentCompletions(slash.state).map((completion) => completion.label)).toEqual(["/section"]);
  });
});
