// @vitest-environment jsdom

import { hasNextSnippetField, pickedCompletion } from "@codemirror/autocomplete";
import { EditorSelection, type Transaction } from "@codemirror/state";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { loadedSnippetRuntime, loadSnippetRuntime } from "./loader";
import { snippetSessions } from "./session";
import { insertTemplate, templateApply } from "./template";
import { destroyViews, press, snippetEditor, withCursor } from "./tests/editor";

stubRangeGeometry();

beforeAll(() => installEnglishEditorMessages());

afterEach(() => destroyViews());

describe("templates before the snippet code has loaded", () => {
  it("insert with CodeMirror's own fields, then load the snippet code", async () => {
    expect(loadedSnippetRuntime()).toBeNull();
    const transactions: Transaction[] = [];
    const view = snippetEditor("  |", { port: null, session: false, transactions });
    insertTemplate(view, "\\begin{${1:env}}\n\t${2}\n\\end{${1:env}}", 2, 2);
    expect(withCursor(view)).toBe("  \\begin{[env]}\n    \n  \\end{env}");
    expect(hasNextSnippetField(view.state)).toBe(true);
    press(view, "Tab");
    expect(withCursor(view)).toBe("  \\begin{env}\n    |\n  \\end{env}");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "old" }, selection: EditorSelection.range(0, 3) });
    const completion = { label: "x" };
    templateApply("new${}")(view, completion, 0, 0);
    expect(withCursor(view)).toBe("new|");
    expect(transactions.at(-1)?.annotation(pickedCompletion)).toBe(completion);
    expect(transactions.at(-1)?.isUserEvent("input.complete")).toBe(true);
    expect(snippetSessions(view.state)).toEqual([]);
    await loadSnippetRuntime();
    expect(loadedSnippetRuntime()).not.toBeNull();
  });
});

describe("templates once the snippet code has loaded", () => {
  beforeAll(async () => {
    await loadSnippetRuntime();
  });

  it("insert with the editor's own fields", () => {
    const view = snippetEditor("|", { port: null, session: false });
    const apply = templateApply("\\frac{${1}}{${2}}${3}");
    apply(view, null, 0, 0);
    expect(snippetSessions(view.state)).toHaveLength(1);
    press(view, "Tab");
    expect(withCursor(view)).toBe("\\frac{}{|}");
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    apply(view, null, view.state.doc.length, view.state.doc.length);
    expect(view.state.doc.toString()).toBe("\\frac{}{}\\frac{}{}");
    insertTemplate(view, "${1:x}", 0, 0);
    expect(withCursor(view)).toBe("[x]\\frac{}{}\\frac{}{}");
  });
});
