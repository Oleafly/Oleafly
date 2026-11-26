// @vitest-environment jsdom

import { hasNextSnippetField, pickedCompletion, snippet } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { latexLanguage } from "../latex";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { SNIPPET_FLASH_MS } from "./flash";
import { insertSnippet, insertTemplate, templateApply } from "./insert";
import { innermostSnippetSession, snippetSessions } from "./session";
import { destroyViews, fakePort, press, snippetEditor, snippetRecord, type, withCursor } from "./tests/editor";

stubRangeGeometry();

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  destroyViews();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fig = snippetRecord("fig", "\\begin{figure}\n\t${1:body}\n\\end{figure}$0", { description: "Figure" });
const frac = snippetRecord("frac", "\\frac{$1}{$2}$0", { nameKey: "latex.snippet.frac" });
const dots = snippetRecord("dots", "\\ldots");

function depth(view: EditorView): number {
  return snippetSessions(view.state).length;
}

function announcements(transactions: readonly Transaction[]): string[] {
  return transactions.flatMap((tr) =>
    tr.effects.filter((effect) => effect.is(EditorView.announce)).map((effect) => effect.value as string),
  );
}

describe("insertSnippet", () => {
  it("gives back the typed trigger on one undo and re-expands with fields on redo", () => {
    const view = snippetEditor("fig|");
    expect(insertSnippet(view, fig, 0, 3, "tab")).toBe(true);
    expect(withCursor(view)).toBe("\\begin{figure}\n  [body]\n\\end{figure}");
    undo(view);
    expect(withCursor(view)).toBe("fig|");
    expect(depth(view)).toBe(0);
    redo(view);
    expect(view.state.doc.toString()).toBe("\\begin{figure}\n  body\n\\end{figure}");
    expect(depth(view)).toBe(1);
  });

  it("indents every later line like the current one", () => {
    const view = snippetEditor("  fig|");
    insertSnippet(view, fig, 2, 5, "tab");
    expect(view.state.doc.toString()).toBe("  \\begin{figure}\n    body\n  \\end{figure}");
  });

  it("chooses the body for the language the port reports", () => {
    const record = snippetRecord("eq", { latex: "\\[$1\\]", typst: "\\$ $1 \\$", default: "($1)" });
    const typst = snippetEditor("|", { port: fakePort({ language: () => "typst" }) });
    insertSnippet(typst, record, 0, 0, "list");
    expect(typst.state.doc.toString()).toBe("$  $");
    const markdown = snippetEditor("|", { port: fakePort({ language: () => "markdown" }) });
    insertSnippet(markdown, record, 0, 0, "list");
    expect(markdown.state.doc.toString()).toBe("()");
    const loose = snippetEditor("|", { port: fakePort({ language: () => null }) });
    insertSnippet(loose, snippetRecord("only", { latex: "only" }), 0, 0, "list");
    expect(loose.state.doc.toString()).toBe("only");
  });

  it("wraps the selection when the body uses it", () => {
    const view = snippetEditor("|");
    view.dispatch({ changes: { from: 0, insert: "word" }, selection: EditorSelection.range(0, 4) });
    insertSnippet(view, snippetRecord("bold", "\\textbf{${TM_SELECTED_TEXT}}$0"), 0, 4, "palette");
    expect(withCursor(view)).toBe("\\textbf{word}|");
  });

  it("leaves the selection out of a body that does not wrap", () => {
    const view = snippetEditor("|");
    view.dispatch({ changes: { from: 0, insert: "word" }, selection: EditorSelection.range(0, 4) });
    insertSnippet(view, snippetRecord("plain", "[$1]"), 4, 4, "palette");
    expect(view.state.doc.toString()).toBe("word[]");
  });

  it("renders one copy at each cursor with no fields", () => {
    const view = snippetEditor("a fig|\nb fig|\nc fog|");
    const main = view.state.selection.main.head;
    insertSnippet(view, frac, main - 3, main, "tab");
    expect(view.state.doc.toString()).toBe("a \\frac{}{}\nb \\frac{}{}\nc fog");
    expect(depth(view)).toBe(0);
    const spread = snippetEditor("x|\ny|");
    insertSnippet(spread, frac, spread.state.selection.main.head, spread.state.selection.main.head, "palette");
    expect(spread.state.doc.toString()).toBe("x\\frac{}{}\ny\\frac{}{}");
    expect(spread.state.selection.ranges.map((range) => range.head)).toEqual([10, 21]);
    expect(depth(spread)).toBe(0);
  });

  it("marks auto expansions as typing and the rest as completion, with an announcement", () => {
    const transactions: Transaction[] = [];
    const view = snippetEditor("|", { transactions });
    insertSnippet(view, frac, 0, 0, "auto");
    insertSnippet(view, snippetRecord("plain", "plain"), 9, 9, "hint");
    expect(transactions[0].isUserEvent("input.type")).toBe(true);
    expect(transactions.at(-1)?.isUserEvent("input.complete")).toBe(true);
    expect(announcements(transactions)).toEqual(["Inserted Fraction", "Inserted plain"]);
  });

  it("records the use and says no for a read-only editor or a record without a body", () => {
    const recordUse = vi.fn();
    const view = snippetEditor("|", { port: fakePort({ recordUse }) });
    insertSnippet(view, frac, 0, 0, "list");
    expect(recordUse).toHaveBeenCalledWith("frac");
    expect(insertSnippet(view, { ...frac, bodies: {} }, 0, 0, "list")).toBe(false);
    const locked = snippetEditor("|", { extensions: [EditorState.readOnly.of(true)] });
    expect(insertSnippet(locked, frac, 0, 0, "list")).toBe(false);
  });

  it("reads the clipboard only for a body that uses it", async () => {
    const readClipboard = vi.fn(() => Promise.resolve("copied"));
    const view = snippetEditor("|", { port: fakePort({ readClipboard }) });
    insertSnippet(view, frac, 0, 0, "list");
    expect(readClipboard).not.toHaveBeenCalled();
    const paste = snippetRecord("paste", "[${CLIPBOARD}]$0");
    const fresh = snippetEditor("|", { port: fakePort({ readClipboard }) });
    expect(insertSnippet(fresh, paste, 0, 0, "list")).toBe(true);
    await vi.waitFor(() => expect(fresh.state.doc.toString()).toBe("[copied]"));
  });

  it("uses an empty clipboard when reading fails and drops the insert when the text moved on", async () => {
    const paste = snippetRecord("paste", "[${CLIPBOARD}]$0");
    const failing = snippetEditor("|", { port: fakePort({ readClipboard: () => Promise.reject(new Error("denied")) }) });
    insertSnippet(failing, paste, 0, 0, "list");
    await vi.waitFor(() => expect(failing.state.doc.toString()).toBe("[]"));
    let release: (text: string) => void = () => undefined;
    const slow = snippetEditor("|", {
      port: fakePort({ readClipboard: () => new Promise<string>((resolve) => (release = resolve)) }),
    });
    insertSnippet(slow, paste, 0, 0, "list");
    type(slow, "x");
    release("late");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slow.state.doc.toString()).toBe("x");
  });

  it("fills the comment token and file variables from the state and the port", () => {
    const record = snippetRecord("head", "${LINE_COMMENT} ${TM_FILENAME_BASE} ${PROJECT_NAME}");
    const latex = snippetEditor("|", { extensions: [latexLanguage()] });
    insertSnippet(latex, record, 0, 0, "list");
    expect(latex.state.doc.toString()).toBe("% main Paper");
    const typst = snippetEditor("|", { port: fakePort({ language: () => "typst", filePath: () => null }) });
    insertSnippet(typst, record, 0, 0, "list");
    expect(typst.state.doc.toString()).toBe("//  Paper");
    const plain = snippetEditor("|", { port: fakePort({ language: () => "bibtex", projectName: () => null }) });
    insertSnippet(plain, record, 0, 0, "list");
    expect(plain.state.doc.toString()).toBe("% main ");
  });

  it("tints the inserted text for 200 ms unless motion is reduced or it is one character", async () => {
    vi.useFakeTimers();
    const view = snippetEditor("|");
    insertSnippet(view, dots, 0, 0, "list");
    expect(view.dom.querySelector(".cm-oleaflySnippetFlash")?.textContent).toBe("\\ldots");
    await vi.advanceTimersByTimeAsync(SNIPPET_FLASH_MS);
    expect(view.dom.querySelector(".cm-oleaflySnippetFlash")).toBeNull();
    const single = snippetEditor("|");
    insertSnippet(single, snippetRecord("one", "x"), 0, 0, "list");
    expect(single.dom.querySelector(".cm-oleaflySnippetFlash")).toBeNull();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const calm = snippetEditor("|");
    insertSnippet(calm, dots, 0, 0, "list");
    expect(calm.dom.querySelector(".cm-oleaflySnippetFlash")).toBeNull();
  });

  it("keeps a newer tint when an older one times out", async () => {
    vi.useFakeTimers();
    const view = snippetEditor("|");
    insertSnippet(view, dots, 0, 0, "list");
    await vi.advanceTimersByTimeAsync(SNIPPET_FLASH_MS / 2);
    const head = view.state.doc.length;
    insertSnippet(view, snippetRecord("cdots", "\\cdots"), head, head, "list");
    await vi.advanceTimersByTimeAsync(SNIPPET_FLASH_MS / 2);
    expect(view.dom.querySelector(".cm-oleaflySnippetFlash")?.textContent).toBe("\\cdots");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length } });
    await vi.advanceTimersByTimeAsync(SNIPPET_FLASH_MS);
    expect(view.dom.querySelector(".cm-oleaflySnippetFlash")).toBeNull();
  });

  it("ends a CodeMirror snippet session before starting its own", () => {
    const view = snippetEditor("|");
    snippet("${a} ${b}")(view, null, 0, 0);
    expect(hasNextSnippetField(view.state)).toBe(true);
    insertSnippet(view, frac, 0, 1, "list");
    expect(hasNextSnippetField(view.state)).toBe(false);
    expect(depth(view)).toBe(1);
  });
});

describe("templates", () => {
  it("behaves like CodeMirror's snippet() for a two-field fraction", () => {
    const view = snippetEditor("|");
    templateApply("\\frac{${}}{${}}")(view, null, 0, 0);
    expect(withCursor(view)).toBe("\\frac{|}{}");
    type(view, "a");
    press(view, "Tab");
    expect(withCursor(view)).toBe("\\frac{a}{|}");
    expect(depth(view)).toBe(0);
  });

  it("puts the caret in a lone field without starting a session", () => {
    const view = snippetEditor("|");
    insertTemplate(view, "\\left( ${} \\right)", 0, 0);
    expect(withCursor(view)).toBe("\\left( | \\right)");
    expect(depth(view)).toBe(0);
  });

  it("replaces the whole selection when the range ends at its start, and marks the pick", () => {
    const transactions: Transaction[] = [];
    const view = snippetEditor("|", { transactions });
    view.dispatch({ changes: { from: 0, insert: "old" }, selection: EditorSelection.range(0, 3) });
    const completion = { label: "x" };
    insertTemplate(view, "new${}", 0, 0, completion);
    expect(view.state.doc.toString()).toBe("new");
    expect(transactions.at(-1)?.annotation(pickedCompletion)).toBe(completion);
    expect(transactions.at(-1)?.isUserEvent("input.complete")).toBe(true);
  });

  it("replaces the given range when it does not end at the caret", () => {
    const view = snippetEditor("\\begin{ali|}");
    insertTemplate(view, "align}\n\t${1}\n\\end{align}${}", 7, 11);
    expect(withCursor(view)).toBe("\\begin{align}\n  |\n\\end{align}");
  });

  it("installs the session on demand with its own Tab keys", () => {
    const view = snippetEditor("|", { session: false });
    const apply = templateApply("\\frac{${1}}{${2}}${3}");
    apply(view, null, 0, 0);
    press(view, "Tab");
    expect(withCursor(view)).toBe("\\frac{}{|}");
    press(view, "Tab", true);
    expect(withCursor(view)).toBe("\\frac{|}{}");
    expect(innermostSnippetSession(view.state)?.active).toBe(0);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    apply(view, null, view.state.doc.length, view.state.doc.length);
    expect(view.state.doc.toString()).toBe("\\frac{}{}\\frac{}{}");
  });
});
