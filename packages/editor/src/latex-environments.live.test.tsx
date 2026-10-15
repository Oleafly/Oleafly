// @vitest-environment jsdom

import { createElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { LocalDocumentSession } from "./document-session";
import { closeEnvironmentOnEnter } from "./latex-environments";
import { englishEditorMessage } from "./test-messages";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const SETTINGS: ReturnType<EditorHost["useSettings"]> = {
  keymap: "default",
  tabSize: 2,
  lineWrap: true,
  spellcheck: false,
  harper: false,
  editorTheme: "system",
  autocomplete: false,
  autoCloseBrackets: true,
  cursorBlinking: "blink",
  highlightCurrentLine: true,
  cursorHeight: "text",
  ghostCompletion: false,
  stickyScroll: false,
  mathPreview: false,
};

let unmountEditor: (() => void) | null = null;

afterEach(() => {
  unmountEditor?.();
  unmountEditor = null;
  vi.restoreAllMocks();
});

async function mountShared(session: LocalDocumentSession) {
  const store = create(() => ({ activePath: session.path, docVersion: 0 }));
  const setContent = vi.fn();
  const host: EditorHost = {
    t: englishEditorMessage,
    useActivePath: () => store((s) => s.activePath),
    getActivePath: () => store.getState().activePath,
    useDocVersion: () => store((s) => s.docVersion),
    useCompletionSyntax: () => "latex",
    getContent: () => "",
    setContent,
    documentSession: (path) => (path === session.path ? session : null),
    useSettings: () => SETTINGS,
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
  unmountEditor = render(createElement(CodeMirrorEditor, { active: true, host })).unmount;
  await act(async () => {});
  return { setContent };
}

function view(): EditorView {
  const current = getEditorView();
  if (!current) throw new Error("The editor did not mount.");
  return current;
}

function typeAt(pos: number, text: string): void {
  view().dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
}

function typeKeys(text: string): void {
  for (const character of text) {
    act(() => {
      const target = view();
      const { from, to } = target.state.selection.main;
      const handled = target.state
        .facet(EditorView.inputHandler)
        .some((handler) =>
          handler(target, from, to, character, () =>
            target.state.update({ changes: { from, to, insert: character } }),
          ),
        );
      if (!handled) {
        target.dispatch({ ...target.state.replaceSelection(character), userEvent: "input.type" });
      }
    });
  }
}

function caretMarked(): string {
  const state = view().state;
  const head = state.selection.main.head;
  return `${state.sliceDoc(0, head)}|${state.sliceDoc(head)}`;
}

function pressEnter(): boolean {
  let handled = false;
  act(() => {
    handled = closeEnvironmentOnEnter(view());
  });
  return handled;
}

const BEGIN = String.raw`\begin{itemize}`;

describe("closing an environment on Enter in a live shared document", () => {
  it("still closes \\begin{itemize} when a collaborator's edit lands before the line between the } and the Enter", async () => {
    const session = new LocalDocumentSession("main.tex", "Intro\n\nOutro\n");
    const { setContent } = await mountShared(session);
    act(() => typeAt(6, BEGIN));

    act(() => session.pushRemote([{ from: 0, to: 0, insert: "Carol " }]));

    expect(pressEnter()).toBe(true);
    expect(caretMarked()).toBe(`Carol Intro\n${BEGIN}\n  \\item |\n\\end{itemize}\nOutro\n`);
    expect(session.text()).toBe(view().state.doc.toString());
    expect(setContent).not.toHaveBeenCalled();
  });

  it("overtypes the auto-inserted } and closes the list when collaborators type while it is being written", async () => {
    const session = new LocalDocumentSession("main.tex", "Intro\n\nOutro\n");
    await mountShared(session);
    act(() => view().dispatch({ selection: { anchor: 6 } }));

    typeKeys(String.raw`\begin{`);
    expect(caretMarked()).toBe(`Intro\n\\begin{|}\nOutro\n`);
    act(() => session.pushRemote([{ from: 0, to: 0, insert: "Carol " }]));
    typeKeys("itemize}");
    act(() => session.pushRemote([{ from: session.text().length, to: session.text().length, insert: "Dave\n" }]));

    expect(caretMarked()).toBe(`Carol Intro\n${BEGIN}|\nOutro\nDave\n`);
    expect(pressEnter()).toBe(true);
    expect(caretMarked()).toBe(`Carol Intro\n${BEGIN}\n  \\item |\n\\end{itemize}\nOutro\nDave\n`);
    expect(session.text()).toBe(view().state.doc.toString());
  });

  it("still closes \\begin{itemize} when a collaborator's edit lands below the line", async () => {
    const session = new LocalDocumentSession("main.tex", "Intro\n\nOutro\n");
    await mountShared(session);
    act(() => typeAt(6, BEGIN));

    act(() => session.pushRemote([{ from: session.text().length, to: session.text().length, insert: "Carol\n" }]));

    expect(pressEnter()).toBe(true);
    expect(caretMarked()).toBe(`Intro\n${BEGIN}\n  \\item |\n\\end{itemize}\nOutro\nCarol\n`);
    expect(session.text()).toBe(view().state.doc.toString());
  });

  it("does not add a second \\end{itemize} when a collaborator already closed the list", async () => {
    const session = new LocalDocumentSession("main.tex", "Intro\n\nOutro\n");
    await mountShared(session);
    act(() => typeAt(6, BEGIN));
    const end = session.text().indexOf("Outro");

    act(() => session.pushRemote([{ from: end, to: end, insert: "\\end{itemize}\n" }]));

    expect(pressEnter()).toBe(false);
    expect(view().state.doc.toString()).toBe(`Intro\n${BEGIN}\n\\end{itemize}\nOutro\n`);
    expect(session.text()).toBe(view().state.doc.toString());
  });

  it("leaves Enter alone when a collaborator typed after the caret on the same line", async () => {
    const session = new LocalDocumentSession("main.tex", "Intro\n\nOutro\n");
    await mountShared(session);
    act(() => typeAt(6, BEGIN));
    const caret = view().state.selection.main.head;

    act(() => session.pushRemote([{ from: caret, to: caret, insert: " % note" }]));

    expect(caretMarked()).toBe(`Intro\n${BEGIN}| % note\nOutro\n`);
    expect(pressEnter()).toBe(false);
    expect(session.text()).toBe(view().state.doc.toString());
  });
});
