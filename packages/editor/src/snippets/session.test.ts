// @vitest-environment jsdom

import { autocompletion, CompletionContext, completionStatus, currentCompletions } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { ChangeSet, EditorSelection, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { documentLoad, remoteChange } from "../collaboration";
import { latexLanguage } from "../latex";
import { latexPairInputHandler, latexPairKeymap } from "../latex-pairs";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { snippetCompletionSource } from "./completion";
import { insertSnippet, insertTemplate } from "./insert";
import {
  activeSnippetField,
  endSnippetSession,
  innermostSnippetSession,
  mapSnippetSession,
  nextSnippetField,
  previousSnippetField,
  snippetFieldCompletions,
  snippetSessions,
  syncSnippetMirrors,
} from "./session";
import { destroyViews, fakePort, input, press, snippetEditor, snippetRecord, type, withCursor } from "./tests/editor";

stubRangeGeometry();

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  destroyViews();
  vi.useRealTimers();
});

const frac = snippetRecord("frac", "\\frac{$1}{$2}$0");
const sum = snippetRecord("sum", "\\sum_{${1:i=1}}^{${2:n}} $0");
const caption = snippetRecord("cap", "\\caption{${1:Caption}}\\label{fig:${1/slug}}$0");
const figure = snippetRecord("fig", "\\begin{figure}[${1|htbp,t,b,H|}]\n\\includegraphics{${2@image}}\n\\end{figure}$0");

function expand(view: EditorView, record = frac, kind: "tab" | "list" = "tab"): EditorView {
  const head = view.state.selection.main.head;
  insertSnippet(view, record, head, head, kind);
  return view;
}

function popup() {
  return autocompletion({ override: [snippetCompletionSource()], activateOnTyping: false, interactionDelay: 0 });
}

function depth(view: EditorView): number {
  return snippetSessions(view.state).length;
}

function remote(view: EditorView, from: number, to: number, insert: string): void {
  view.dispatch({
    changes: { from, to, insert },
    annotations: [remoteChange.of(true), Transaction.addToHistory.of(false)],
  });
}

describe("field navigation", () => {
  it("walks 1 → 2 → exit with Tab and pops the session", () => {
    const view = expand(snippetEditor("$|$"));
    expect(withCursor(view)).toBe("$\\frac{|}{}$");
    type(view, "a");
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{a}{|}$");
    type(view, "b");
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{a}{b}|$");
    expect(depth(view)).toBe(0);
    expect(nextSnippetField(view)).toBe(false);
  });

  it("makes a clicked field the active one, so the card and Tab follow it", () => {
    const view = snippetEditor("|");
    insertSnippet(view, snippetRecord("three", "${1:a} ${2:b} ${3:c}$0"), 0, 0, "tab");
    view.dispatch({ selection: EditorSelection.cursor(5), userEvent: "select.pointer" });
    expect(view.dom.querySelector(".cm-oleaflySnippetCard")?.textContent).toContain("3 of 3");
    press(view, "Tab");
    expect(withCursor(view)).toBe("a b c|");
    expect(depth(view)).toBe(0);
  });

  it("keeps text typed at the end of a field out of the next field", () => {
    const view = snippetEditor("|");
    insertSnippet(view, snippetRecord("pair", "<${1:a}${2:b}>$0"), 0, 0, "tab");
    type(view, "xy");
    press(view, "Tab");
    expect(withCursor(view)).toBe("<xy[b]>");
  });

  it("goes back with Shift-Tab and lets Shift-Tab fall through on the first field", () => {
    const view = expand(snippetEditor("|"));
    press(view, "Tab");
    expect(previousSnippetField(view)).toBe(true);
    expect(withCursor(view)).toBe("\\frac{|}{}");
    expect(previousSnippetField(view)).toBe(false);
    expect(innermostSnippetSession(view.state)?.active).toBe(0);
  });

  it("selects a placeholder and replaces it as you type", () => {
    const view = expand(snippetEditor("|"), sum);
    expect(withCursor(view)).toBe("\\sum_{[i=1]}^{n} ");
    type(view, "k");
    press(view, "Tab");
    expect(withCursor(view)).toBe("\\sum_{k}^{[n]} ");
  });

  it("ends on an exit field that has a placeholder, selecting it", () => {
    const view = snippetEditor("|");
    insertTemplate(view, "${index} = ${end}", 0, 0);
    expect(withCursor(view)).toBe("[index] = end");
    press(view, "Tab");
    expect(withCursor(view)).toBe("index = [end]");
    expect(depth(view)).toBe(0);
  });

  it("keeps the session on an exit field that has mirrors until the next Tab", () => {
    const view = snippetEditor("|");
    insertTemplate(view, "\\begin{${1:env}}\nx\n\\end{${1:env}}", 0, 0);
    expect(withCursor(view)).toBe("\\begin{[env]}\nx\n\\end{env}");
    expect(activeSnippetField(view.state)?.index).toBe(0);
    type(view, "itemize");
    expect(view.state.doc.toString()).toBe("\\begin{itemize}\nx\n\\end{itemize}");
    press(view, "Tab");
    expect(withCursor(view)).toBe("\\begin{itemize|}\nx\n\\end{itemize}");
    expect(depth(view)).toBe(0);
  });
});

describe("mirrors", () => {
  it("updates the slug in the same transaction and one undo reverts both", () => {
    const transactions: Transaction[] = [];
    const view = expand(snippetEditor("|", { transactions }), caption);
    expect(view.state.doc.toString()).toBe("\\caption{Caption}\\label{fig:caption}");
    transactions.length = 0;
    type(view, "R");
    expect(transactions).toHaveLength(1);
    expect(view.state.doc.toString()).toBe("\\caption{R}\\label{fig:r}");
    type(view, "adio map");
    expect(view.state.doc.toString()).toBe("\\caption{Radio map}\\label{fig:radio-map}");
    undo(view);
    expect(view.state.doc.toString()).toBe("\\caption{Caption}\\label{fig:caption}");
  });

  it("restores the active field on undo and the session on redo", () => {
    const view = expand(snippetEditor("|"));
    type(view, "a");
    press(view, "Tab");
    type(view, "b");
    undo(view);
    expect(withCursor(view)).toBe("\\frac{a}{|}");
    expect(innermostSnippetSession(view.state)?.active).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe("\\frac{}{}");
    expect(innermostSnippetSession(view.state)?.active).toBe(0);
    undo(view);
    expect(view.state.doc.toString()).toBe("");
    expect(depth(view)).toBe(0);
    redo(view);
    expect(view.state.doc.toString()).toBe("\\frac{}{}");
    expect(depth(view)).toBe(1);
    redo(view);
    redo(view);
    expect(innermostSnippetSession(view.state)?.active).toBe(1);
    type(view, "c");
    expect(view.state.doc.toString()).toBe("\\frac{a}{bc}");
  });

  it("syncs a mirror once composition ends and joins the composed undo step", async () => {
    vi.useFakeTimers();
    const transactions: Transaction[] = [];
    const view = expand(snippetEditor("|", { transactions }), caption);
    transactions.length = 0;
    view.dispatch(view.state.replaceSelection("Ab"), { userEvent: "input.type.compose.start" });
    expect(view.state.doc.toString()).toBe("\\caption{Ab}\\label{fig:caption}");
    expect(transactions).toHaveLength(1);
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(view.state.doc.toString()).toBe("\\caption{Ab}\\label{fig:ab}");
    undo(view);
    expect(view.state.doc.toString()).toBe("\\caption{Caption}\\label{fig:caption}");
  });

  it("does nothing to sync when there is no session, no difference or a composition", () => {
    const view = snippetEditor("|");
    expect(syncSnippetMirrors(view)).toBe(false);
    expand(view, caption);
    expect(syncSnippetMirrors(view)).toBe(false);
    Object.defineProperty(view, "composing", { configurable: true, get: () => true });
    expect(syncSnippetMirrors(view)).toBe(false);
  });

  it("leaves the mirrors of other fields where they are", () => {
    const view = snippetEditor("|");
    insertSnippet(view, snippetRecord("pair", "${1:a} ${2:b} ${1/upper} ${2/upper}$0"), 0, 0, "tab");
    type(view, "x");
    press(view, "Tab");
    type(view, "yz");
    expect(view.state.doc.toString()).toBe("x yz X YZ");
    expect(innermostSnippetSession(view.state)?.mirrors.map((mirror) => [mirror.from, mirror.to])).toEqual([
      [5, 6],
      [7, 9],
    ]);
  });

  it("keeps a mirror next to its field apart from what is typed", () => {
    const view = snippetEditor("|");
    insertSnippet(view, snippetRecord("twice", "$1${1/upper}$0"), 0, 0, "tab");
    type(view, "ab");
    expect(view.state.doc.toString()).toBe("abAB");
    const mirror = innermostSnippetSession(view.state)?.mirrors[0];
    expect(mirror).toMatchObject({ from: 2, to: 4 });
  });

  it("maps a session through changes", () => {
    const view = expand(snippetEditor("|"));
    const session = innermostSnippetSession(view.state);
    if (!session) throw new Error("expected a session");
    expect(mapSnippetSession(session, ChangeSet.empty(view.state.doc.length))).toBe(session);
    const shifted = mapSnippetSession(session, ChangeSet.of({ from: 0, insert: "xy" }, view.state.doc.length));
    expect(shifted.fields[0].ranges[0]).toEqual({ from: 8, to: 8 });
    expect(shifted.exit).toBe(11);
  });
});

describe("nested sessions", () => {
  it("finishes the inner snippet, then Tab continues the outer one", () => {
    const view = expand(snippetEditor("$|$"));
    expand(view, sum);
    expect(depth(view)).toBe(2);
    expect(withCursor(view)).toBe("$\\frac{\\sum_{[i=1]}^{n} }{}$");
    press(view, "Tab");
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{\\sum_{i=1}^{n} |}{}$");
    expect(depth(view)).toBe(1);
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{\\sum_{i=1}^{n} }{|}$");
  });

  it("updates an outer mirror when an inner snippet lands in its field", () => {
    const view = snippetEditor("|");
    insertTemplate(view, "\\begin{${1}}\n${2}\n\\end{${1}}", 0, 0);
    expand(view, snippetRecord("al", "ali${1:gn}$0"));
    expect(view.state.doc.toString()).toBe("\\begin{align}\n\n\\end{align}");
  });

  it("keeps the inner session when a composition inside it syncs an outer mirror", async () => {
    vi.useFakeTimers();
    const view = snippetEditor("|");
    insertTemplate(view, "\\begin{${1}}\n${2}\n\\end{${1}}", 0, 0);
    expand(view, snippetRecord("al", "ali${1:gn}$0"));
    view.dispatch(view.state.replaceSelection("x"), { userEvent: "input.type.compose.start" });
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await vi.runAllTimersAsync();
    expect(view.state.doc.toString()).toBe("\\begin{alix}\n\n\\end{alix}");
    expect(depth(view)).toBe(2);
  });

  it("shows the field card with its keys and follows the inner session while one is open", () => {
    const view = expand(snippetEditor("|"));
    const card = () => view.dom.querySelector(".cm-oleaflySnippetCard");
    expect(card()?.textContent).toBe("1 of 2TabNext⇧ TabBackEscDone");
    expect(card()?.querySelectorAll(".cm-oleaflySnippetCard-step")).toHaveLength(2);
    expect(card()?.querySelector(".cm-oleaflySnippetCard-step-now")).toBe(card()?.querySelector(".cm-oleaflySnippetCard-step"));
    expect(card()?.querySelector(".cm-oleaflySnippetCard-key-off")?.textContent).toBe("⇧ TabBack");
    press(view, "Tab");
    expect(card()?.textContent).toBe("2 of 2TabFinish⇧ TabBackEscDone");
    expect(card()?.querySelector(".cm-oleaflySnippetCard-key-off")).toBeNull();
    expect(card()?.querySelectorAll(".cm-oleaflySnippetCard-step-done")).toHaveLength(1);
    expand(view, sum);
    expect(card()?.textContent).toContain("1 of 2");
    press(view, "Escape");
    expect(card()?.textContent).toContain("2 of 2");
    press(view, "Escape");
    expect(card()).toBeNull();
  });

  it("shows the keys every time, also for a single field", () => {
    for (let round = 0; round < 6; round += 1) {
      const view = expand(snippetEditor("|"));
      expect(view.dom.querySelector(".cm-oleaflySnippetCard")?.textContent).toBe("1 of 2TabNext⇧ TabBackEscDone");
    }
    const single = expand(snippetEditor("|"), caption);
    expect(single.dom.querySelector(".cm-oleaflySnippetCard")?.textContent).toBe("1 of 1TabFinish⇧ TabBackEscDone");
  });

  it("drops the dots for long snippets but keeps the count", () => {
    const view = expand(snippetEditor("|"), snippetRecord("many", "$1 $2 $3 $4 $5 $6 $7 $8 $9$0"));
    const card = view.dom.querySelector(".cm-oleaflySnippetCard");
    expect(card?.querySelector(".cm-oleaflySnippetCard-steps")).toBeNull();
    expect(card?.textContent).toBe("1 of 9TabNext⇧ TabBackEscDone");
  });
});

describe("collaboration", () => {
  it("keeps the session for a remote change outside the fields and never adds a mirror edit to it", () => {
    const transactions: Transaction[] = [];
    const view = expand(snippetEditor("Intro |", { transactions }), caption);
    transactions.length = 0;
    remote(view, 0, 0, "A ");
    expect(depth(view)).toBe(1);
    const field = innermostSnippetSession(view.state)?.fields[0].ranges[0];
    expect(view.state.sliceDoc(field?.from, field?.to)).toBe("Caption");
    const inField = (field?.from ?? 0) + 1;
    remote(view, inField, inField, "x");
    expect(transactions).toHaveLength(2);
    expect(transactions[1].changes.length + 1).toBe(transactions[1].newDoc.length);
    expect(view.state.doc.toString()).toBe("A Intro \\caption{Cxaption}\\label{fig:caption}");
    expect(depth(view)).toBe(1);
    type(view, "Z");
    expect(view.state.doc.toString()).toBe("A Intro \\caption{Z}\\label{fig:z}");
  });

  it("maps a remote insert inside the field", () => {
    const view = expand(snippetEditor("|"), sum);
    remote(view, 7, 7, "j,");
    const field = activeSnippetField(view.state)?.ranges[0];
    expect(view.state.sliceDoc(field?.from, field?.to)).toBe("ij,=1");
    expect(depth(view)).toBe(1);
  });

  it("ends the session when a remote edit cuts across a field", () => {
    const view = expand(snippetEditor("|"), sum);
    remote(view, 3, 9, "");
    expect(depth(view)).toBe(0);
  });

  it("clears every session when a new document loads", () => {
    const view = expand(snippetEditor("|"));
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "new" },
      annotations: [documentLoad.of(true), Transaction.addToHistory.of(false)],
    });
    expect(depth(view)).toBe(0);
  });
});

describe("staying alive and ending", () => {
  it("keeps the session while latex pairs close a brace inside the field", () => {
    const view = snippetEditor("$|$", {
      extensions: [latexLanguage(), latexPairInputHandler({ math: true, brackets: true }), keymap.of(latexPairKeymap)],
    });
    expand(view);
    input(view, "{");
    expect(withCursor(view)).toBe("$\\frac{{|}}{}$");
    expect(depth(view)).toBe(1);
    press(view, "Tab");
    expect(withCursor(view)).toBe("$\\frac{{}}{|}$");
  });

  it("ends when the selection leaves every field", () => {
    const view = expand(snippetEditor("Text |"));
    view.dispatch({ selection: EditorSelection.cursor(0), userEvent: "select.pointer" });
    expect(depth(view)).toBe(0);
  });

  it("ends when a local edit lands outside every field", () => {
    const view = expand(snippetEditor("Text |"));
    view.dispatch({ changes: { from: 0, insert: "x" } });
    expect(depth(view)).toBe(0);
  });

  it("ends the innermost session on Escape and lets Escape through", () => {
    const view = expand(snippetEditor("|"));
    expand(view, sum);
    expect(endSnippetSession(view)).toBe(false);
    expect(depth(view)).toBe(1);
    expect(view.state.selection.main.empty).toBe(false);
    press(view, "Escape");
    expect(depth(view)).toBe(0);
    expect(view.state.selection.main.empty).toBe(true);
    expect(endSnippetSession(view)).toBe(false);
  });

  it("leaves the session alone on Escape while the popup is open", async () => {
    const view = snippetEditor("|", { extensions: [popup()] });
    insertSnippet(view, figure, 0, 0, "list");
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    expect(endSnippetSession(view)).toBe(false);
    expect(depth(view)).toBe(1);
  });

  it("clears a session on undo when history holds no session for it", () => {
    const view = snippetEditor("|", { session: false });
    insertTemplate(view, "\\frac{${1}}{${2}}", 0, 0);
    expect(depth(view)).toBe(1);
    undo(view);
    expect(depth(view)).toBe(0);
    expect(view.state.doc.toString()).toBe("");
  });
});

describe("choice and project fields", () => {
  it("offers the choices and replaces the field with the pick", async () => {
    const view = snippetEditor("|", { extensions: [popup()] });
    insertSnippet(view, figure, 0, 0, "list");
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    expect(currentCompletions(view.state).map((option) => option.label)).toEqual(["htbp", "t", "b", "H"]);
    press(view, "ArrowDown");
    press(view, "Enter");
    expect(view.state.doc.line(1).text).toBe("\\begin{figure}[t]");
    expect(depth(view)).toBe(1);
  });

  it("narrows the choices once something is typed in the field", () => {
    const view = snippetEditor("|");
    insertSnippet(view, figure, 0, 0, "list");
    type(view, "h");
    const result = snippetFieldCompletions(new CompletionContext(view.state, view.state.selection.main.head, true));
    expect(result?.options.map((option) => option.label)).toEqual(["htbp", "H"]);
    type(view, "zz");
    expect(snippetFieldCompletions(new CompletionContext(view.state, view.state.selection.main.head, true))).toBeNull();
  });

  it("offers project items in a project field", () => {
    const projectItems = vi.fn(() => [{ label: "fig:map", detail: "Figure 1" }, { label: "sec:intro" }]);
    const view = snippetEditor("|", { port: fakePort({ projectItems }) });
    insertSnippet(view, snippetRecord("ref", "\\ref{${1@label}} and $2"), 0, 0, "list");
    const result = snippetFieldCompletions(new CompletionContext(view.state, 5, true));
    expect(projectItems).toHaveBeenCalledWith("label");
    expect(result?.options.map((option) => [option.label, option.detail])).toEqual([
      ["fig:map", "Figure 1"],
      ["sec:intro", undefined],
    ]);
    expect(snippetFieldCompletions(new CompletionContext(view.state, 0, true))).toBeNull();
    press(view, "Tab");
    expect(snippetFieldCompletions(new CompletionContext(view.state, view.state.selection.main.head, true))).toBeNull();
  });

  it("offers nothing outside a session or without a port", () => {
    const view = snippetEditor("|", { port: null });
    expect(snippetFieldCompletions(new CompletionContext(view.state, 0, true))).toBeNull();
    insertSnippet(view, snippetRecord("ref", "\\ref{${1@label}} $2"), 0, 0, "list");
    expect(snippetFieldCompletions(new CompletionContext(view.state, 5, true))).toBeNull();
  });

  it("opens the list again when Tab reaches a choice field", async () => {
    const view = snippetEditor("|", { extensions: [popup()] });
    insertSnippet(view, snippetRecord("pick", "$1 [${2|a,b|}]"), 0, 0, "list");
    expect(completionStatus(view.state)).toBeNull();
    press(view, "Tab");
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
  });
});

describe("decorations", () => {
  it("marks the active field, the other fields and the mirrors without outlines", () => {
    const view = expand(snippetEditor("|"), caption);
    expect(view.dom.querySelector(".cm-oleaflySnippetField-active")?.textContent).toBe("Caption");
    expect(view.dom.querySelector(".cm-oleaflySnippetMirror")?.textContent).toBe("caption");
    const empty = expand(snippetEditor("|"));
    expect(empty.dom.querySelectorAll(".cm-oleaflySnippetPosition")).toHaveLength(2);
    expect(empty.dom.querySelector(".cm-oleaflySnippetField")).not.toBeNull();
  });
});
