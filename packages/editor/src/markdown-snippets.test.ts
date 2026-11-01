// @vitest-environment jsdom

import { createElement } from "react";
import { render } from "@testing-library/react";
import {
  CompletionContext,
  completionStatus,
  currentCompletions,
  startCompletion,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CodeMirrorEditor, type EditorHost } from "./CodeMirrorEditor";
import { getEditorView } from "./controller";
import { markdownLanguage } from "./markdown";
import { MARKDOWN_SNIPPETS, markdownSlashCompletions } from "./markdown-snippets";
import { englishEditorMessage, installEnglishEditorMessages } from "./test-messages";
import { stubRangeGeometry } from "./test-geometry";

stubRangeGeometry();

const views: EditorView[] = [];

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

function markdownState(doc: string): EditorState {
  return EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdownLanguage()] });
}

function complete(doc: string, pos = doc.length, state = markdownState(doc)): CompletionResult | null {
  const result = markdownSlashCompletions(new CompletionContext(state, pos, false));
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

function accepted(doc: string, label: string): string {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({ parent, state: markdownState(doc) });
  views.push(view);
  const result = complete(doc, doc.length, view.state);
  if (!result) throw new Error(`no completion for ${doc}`);
  const option = result.options.find((candidate: Completion) => candidate.label === label);
  if (typeof option?.apply !== "function") throw new Error(`${label} has no apply`);
  option.apply(view, option, result.from, doc.length);
  return view.state.doc.toString();
}

function host(path: string, content: string): EditorHost {
  return {
    t: englishEditorMessage,
    useActivePath: () => path,
    getActivePath: () => path,
    useDocVersion: () => 0,
    useCompletionSyntax: () => "markdown",
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
      ghostCompletion: false,
      stickyScroll: false,
      mathPreview: false,
    }),
    useVisualMode: () => false,
    useEditorKeymap: () => ({}),
    useLintRefreshDeps: () => [],
  };
}

describe("markdownSlashCompletions", () => {
  it.each([
    ["/table", "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"],
    ["/equation", "$$\n\n$$"],
  ])("expands %s to Markdown", (label, expected) => {
    expect(accepted(label, label)).toBe(expected);
  });

  it("offers every snippet with a described label", () => {
    const result = complete("/");
    expect(result?.from).toBe(0);
    expect(result?.options.map((option) => option.label)).toEqual(MARKDOWN_SNIPPETS.map((entry) => entry.label));
    for (const option of result?.options ?? []) {
      expect(option.type).toBe("snippet");
      expect(option.detail).toMatch(/\S/u);
      expect(option.detail).not.toContain("markdown.snippet");
    }
  });

  it("starts after whitespace outside code and math", () => {
    expect(complete("Text /ta")?.from).toBe(5);
    expect(complete("a/ta")).toBeNull();
    expect(complete("https://example.com/ta")).toBeNull();
    expect(complete("```\n/ta")).toBeNull();
    expect(complete("    code /ta")).toBeNull();
    const inline = "Run `ls /ta` now";
    expect(complete(inline, inline.indexOf("/ta") + 3)).toBeNull();
    const math = "Euler $a /x$ here";
    expect(complete(math, math.indexOf("/x") + 2)).toBeNull();
  });

  it("offers the snippets in a Markdown file", async () => {
    installEnglishEditorMessages();
    const content = "Intro\n/tab";
    const mounted = render(createElement(CodeMirrorEditor, { host: host("notes.md", content) }));
    const view = getEditorView();
    if (!view) throw new Error("editor did not mount");
    view.dispatch({ selection: EditorSelection.cursor(content.length) });
    startCompletion(view);
    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe("active");
      expect(currentCompletions(view.state).map((option) => option.label)).toContain("/table");
    });
    mounted.unmount();
  });
});
