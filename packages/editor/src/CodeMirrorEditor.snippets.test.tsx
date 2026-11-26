// @vitest-environment jsdom

import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { pendingGhostCompletion } from "./ghost-completion";
import { lastAutoExpansion } from "./snippets/auto";
import { type SnippetPort, type SnippetSwitches, snippetPortFacet } from "./snippets/port";
import { snippetSessionField } from "./snippets/session";
import { portWith, press, type, withCursor } from "./snippets/tests/editor";
import { FAST_MATH_ENTRIES, PAPER_ENTRIES, SLASH_ENTRIES } from "./snippets/tests/fixtures";
import { stubRangeGeometry } from "./test-geometry";
import { englishEditorMessage, installEnglishEditorMessages } from "./test-messages";
import { loadTypstParser } from "./typst";

stubRangeGeometry();

beforeAll(async () => {
  installEnglishEditorMessages();
  await loadTypstParser();
});

afterEach(() => vi.restoreAllMocks());

const ENTRIES = {
  ...SLASH_ENTRIES,
  ...FAST_MATH_ENTRIES,
  "paper.theorem": { ...PAPER_ENTRIES["paper.theorem"], languages: "any" },
  "typst.slash.heading": { name: "Heading", prefix: "/heading", body: "= $1", expand: "list", languages: ["typst"], where: "text" },
  "markdown.slash.table": { name: "Table", prefix: "/table", body: "| $1 |", expand: "list", languages: ["markdown"], where: "text" },
  "bibtex.slash.article": { name: "Article", prefix: "/article", body: "@article{$1}", expand: "list", languages: ["bibtex"], where: "text" },
};

const LANGUAGES = { "main.tex": "latex", "main.typ": "typst", "notes.md": "markdown", "refs.bib": "bibtex" } as const;

function host(path: string, content: string, ghostCompletion = false): EditorHost {
  return {
    t: englishEditorMessage,
    useActivePath: () => path,
    getActivePath: () => path,
    useDocVersion: () => 0,
    useCompletionSyntax: () => LANGUAGES[path as keyof typeof LANGUAGES] ?? "generic",
    getContent: () => content,
    setContent: () => {},
    useSettings: () => ({
      keymap: "default",
      tabSize: 2,
      lineWrap: true,
      spellcheck: false,
      harper: false,
      editorTheme: "system",
      autocomplete: true,
      autoCloseBrackets: true,
      cursorBlinking: "blink",
      highlightCurrentLine: true,
      cursorHeight: "text",
      ghostCompletion,
      stickyScroll: false,
      mathPreview: false,
    }),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
}

function mount(path: string, content: string, snippets?: SnippetPort, ghostCompletion = false) {
  const mounted = render(createElement(CodeMirrorEditor, { host: host(path, content, ghostCompletion), snippets }));
  const view = getEditorView();
  if (!view) throw new Error("editor did not mount");
  view.dispatch({ selection: EditorSelection.cursor(content.length) });
  return { view, mounted };
}

function portFor(path: string, enabled?: () => SnippetSwitches): SnippetPort {
  return portWith(ENTRIES, {
    language: () => LANGUAGES[path as keyof typeof LANGUAGES] ?? null,
    ...(enabled ? { enabled } : {}),
  });
}

async function listed(view: EditorView): Promise<string[]> {
  startCompletion(view);
  await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
  return currentCompletions(view.state).map((completion) => completion.label);
}

async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await Promise.resolve();
}

describe("snippets in the editor component", () => {
  it.each([
    ["main.tex", "Intro\n/", "/section"],
    ["main.typ", "Intro\n/", "/heading"],
    ["notes.md", "Intro\n/", "/table"],
    ["refs.bib", "/", "/article"],
  ])("installs every snippet piece once in %s", async (path, content, label) => {
    const port = portFor(path);
    const { view, mounted } = mount(path, content, port);
    expect(view.state.facet(snippetPortFacet)).toBe(port);
    await vi.waitFor(() => expect(view.state.field(snippetSessionField, false)).toEqual([]));
    expect(view.state.field(lastAutoExpansion, false)).toBeNull();
    const labels = await listed(view);
    expect(labels.filter((candidate) => candidate === label)).toHaveLength(1);
    mounted.unmount();
  });

  it("installs nothing snippet-related without a port", async () => {
    const { view, mounted } = mount("main.tex", "Intro\n/");
    expect(view.state.facet(snippetPortFacet)).toBeNull();
    expect(view.state.field(snippetSessionField, false)).toBeUndefined();
    expect(view.state.field(lastAutoExpansion, false)).toBeUndefined();
    startCompletion(view);
    await settle();
    expect(currentCompletions(view.state).map((completion) => completion.label)).not.toContain("/section");
    mounted.unmount();
  });

  it("shows snippet hints with word previews off", async () => {
    const { view, mounted } = mount("main.tex", "", portFor("main.tex"), false);
    type(view, "th");
    await vi.waitFor(() => expect(view.dom.querySelector(".cm-ghostSnippet")?.textContent).toBe("⇥ Theorem"));
    expect(pendingGhostCompletion(view)).toBe("m");
    press(view, "Tab");
    expect(view.state.doc.toString()).toBe("\\begin{theorem}\n  \n\\end{theorem}");
    mounted.unmount();
  });

  it("keeps word previews working beside snippet hints", async () => {
    const { view, mounted } = mount("main.tex", "\\sec", portFor("main.tex"), true);
    await vi.waitFor(() => expect(pendingGhostCompletion(view)).toBe("tion"));
    mounted.unmount();
  });

  it("reads the switches from the port on every keystroke", () => {
    let auto = false;
    const port = portFor("main.tex", () => ({ list: true, tab: true, auto, hint: true }));
    const { view, mounted } = mount("main.tex", "$x $", port);
    view.dispatch({ selection: EditorSelection.cursor(3) });
    type(view, "//");
    expect(view.state.doc.toString()).toBe("$x //$");
    auto = true;
    view.dispatch({ changes: { from: 3, to: 5 }, selection: EditorSelection.cursor(3) });
    type(view, "//");
    expect(withCursor(view)).toBe("$x \\frac{|}{}$");
    mounted.unmount();
  });

  it("expands auto snippets before LaTeX pairs and lets Tab indent when nothing matches", () => {
    const { view, mounted } = mount("main.tex", "$ $", portFor("main.tex"));
    view.dispatch({ selection: EditorSelection.cursor(2) });
    type(view, "lr{");
    expect(withCursor(view)).toBe("$ \\left\\{ | \\right.$");
    const plain = mount("main.tex", "plain", portFor("main.tex"));
    plain.view.dispatch({ selection: EditorSelection.cursor(0) });
    press(plain.view, "Tab");
    expect(plain.view.state.doc.toString()).toBe("  plain");
    plain.mounted.unmount();
    mounted.unmount();
  });
});
