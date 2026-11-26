// @vitest-environment jsdom

import {
  autocompletion,
  type Completion,
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
  completionStatus,
  currentCompletions,
  pickedCompletion,
} from "@codemirror/autocomplete";
import type { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { latexLanguage } from "../latex";
import { markdownLanguage } from "../markdown";
import { stubRangeGeometry } from "../test-geometry";
import { installEnglishEditorMessages } from "../test-messages";
import { loadTypstParser, typstLanguage } from "../typst";
import { snippetCompletionSource, snippetInfo } from "./completion";
import { insertSnippet } from "./insert";
import { loadSnippetRuntime, withSnippetCompletions } from "./loader";
import { activeSnippetField } from "./session";
import { destroyViews, input, portWith, snippetEditor, type, withCursor } from "./tests/editor";
import { AT_ENTRIES, FAST_MATH_ENTRIES, PAPER_ENTRIES, SLASH_ENTRIES } from "./tests/fixtures";
import type { SnippetPort } from "./port";

stubRangeGeometry();

beforeAll(async () => {
  installEnglishEditorMessages();
  await Promise.all([loadTypstParser(), loadSnippetRuntime()]);
});

afterEach(() => destroyViews());

const ENTRIES = { ...SLASH_ENTRIES, ...AT_ENTRIES, ...PAPER_ENTRIES, ...FAST_MATH_ENTRIES };

function latexEditor(marked: string, overrides: Partial<SnippetPort> = {}): EditorView {
  return snippetEditor(marked, { port: portWith(ENTRIES, overrides), extensions: [latexLanguage()] });
}

function complete(view: EditorView, explicit = false): CompletionResult | null {
  const result = snippetCompletionSource()(new CompletionContext(view.state, view.state.selection.main.head, explicit));
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

function labels(result: CompletionResult | null): string[] {
  return result?.options.map((option) => option.label) ?? [];
}

function option(result: CompletionResult | null, label: string): Completion {
  const found = result?.options.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`no option ${label}`);
  return found;
}

function apply(view: EditorView, result: CompletionResult, label: string): void {
  const chosen = option(result, label);
  (chosen.apply as (view: EditorView, completion: Completion, from: number, to: number) => void)(
    view,
    chosen,
    result.from,
    view.state.selection.main.head,
  );
}

describe("snippetCompletionSource in LaTeX", () => {
  it("lists the slash records after a slash at the start of a line", () => {
    const result = complete(latexEditor("/|"));
    expect(result?.from).toBe(0);
    expect(labels(result)).toEqual(["/frac", "/section", "/subsection"]);
  });

  it("narrows the slash records to the typed prefix, even inside a word", () => {
    const result = complete(latexEditor("word/sec|"));
    expect(result?.from).toBe(4);
    expect(labels(result)).toEqual(["/section"]);
  });

  it("lists no slash records in math", () => {
    expect(complete(latexEditor("$x /|$"))).toBeNull();
  });

  it("lists the @ records in math and none in text", () => {
    expect(labels(complete(latexEditor("$x = @|$")))).toEqual(["@a", "@b"]);
    expect(complete(latexEditor("Text @|"))).toBeNull();
  });

  it("stays quiet for a word trigger until the list is asked for", () => {
    const view = latexEditor("fig|");
    expect(complete(view)).toBeNull();
    expect(labels(complete(view, true))).toEqual(["fig", "figref", "figs"]);
  });

  it("lists every fitting record on an explicit request after a space", () => {
    const result = complete(latexEditor("Some prose |"), true);
    expect(result?.from).toBe(11);
    expect(labels(result)).toEqual(expect.arrayContaining(["/section", "figref", "thm"]));
    expect(labels(result)).not.toContain("fig");
    expect(labels(result)).not.toContain("@a");
    expect(labels(result)).not.toContain("//");
  });

  it("asks for nothing when an explicit request matches no trigger", () => {
    expect(complete(latexEditor("zzz|"), true)).toBeNull();
  });

  it("finds a trigger at the end of a line longer than the look-back window", () => {
    const prefix = `${"x".repeat(400)} `;
    const result = complete(latexEditor(`${prefix}/sec|`));
    expect(result?.from).toBe(prefix.length);
  });

  it("lists nothing inside an argument where snippets never fire", () => {
    expect(complete(latexEditor("\\label{/sec|}"))).toBeNull();
  });

  it("lists nothing while the list switch is off", () => {
    const view = latexEditor("/|", { enabled: () => ({ list: false, tab: true, auto: true, hint: true }) });
    expect(complete(view)).toBeNull();
  });

  it("lists nothing without a port or a language", () => {
    expect(complete(snippetEditor("/|", { port: null, extensions: [latexLanguage()] }))).toBeNull();
    expect(complete(latexEditor("/|", { language: () => null }))).toBeNull();
  });

  it("describes each option and ranks exact triggers and used snippets higher", () => {
    const view = latexEditor("fig|", {
      useCount: (id) => (id === "paper.figref" ? 50 : 0),
      collectionName: (collection) => (collection === "test" ? "Paper pack" : null),
    });
    const result = complete(view, true);
    const fig = option(result, "fig");
    expect(fig).toMatchObject({ displayLabel: "fig Figure", detail: "Paper pack", type: "snippet" });
    expect(fig.boost).toBe(20);
    expect(option(result, "figs").boost).toBe(0);
    expect(option(result, "figref").boost).toBe(30);
  });

  it("shows the collection id when the port has no name for it", () => {
    expect(option(complete(latexEditor("/|")), "/section").detail).toBe("test");
  });

  it("inserts the snippet with its fields and marks the picked completion", () => {
    const transactions: Transaction[] = [];
    const view = snippetEditor("/sec|", {
      port: portWith(ENTRIES),
      extensions: [latexLanguage()],
      transactions,
    });
    const result = complete(view) as CompletionResult;
    apply(view, result, "/section");
    expect(withCursor(view)).toBe("\\section{|}");
    expect(transactions.some((tr) => tr.annotation(pickedCompletion)?.label === "/section")).toBe(true);
  });

  it("drops a stale option after the document changed", () => {
    const view = latexEditor("/sec|");
    const result = complete(view) as CompletionResult;
    type(view, "t");
    apply(view, result, "/section");
    expect(view.state.doc.toString()).toBe("/sect");
  });
});

describe("snippet info", () => {
  it("builds the preview only when asked", () => {
    const renderMathPreview = vi.fn(() => document.createElement("figure"));
    const view = latexEditor("$@|$", { renderMathPreview });
    const alpha = option(complete(view), "@a");
    expect(typeof alpha.info).toBe("function");
    expect(renderMathPreview).not.toHaveBeenCalled();
    const info = (alpha.info as (completion: Completion) => HTMLElement)(alpha);
    expect(renderMathPreview).toHaveBeenCalledWith("\\alpha", "latex");
    expect(info.querySelector("figure")).not.toBeNull();
    expect(info.textContent).toContain("alpha");
    expect(info.textContent).toContain("math · list only");
  });

  it("tints the first field apart from the later ones", () => {
    const view = latexEditor("fig|");
    const fig = option(complete(view, true), "fig");
    const info = (fig.info as (completion: Completion) => HTMLElement)(fig);
    const body = info.querySelector("pre");
    expect(body?.textContent).toBe("\\begin{figure}[htbp]\n  \\caption{Caption}\n\\end{figure}");
    expect(body?.querySelector(".cm-oleaflySnippetField-active")?.textContent).toBe("htbp");
    expect(body?.querySelector(".cm-oleaflySnippetField")?.textContent).toBe("Caption");
    expect(info.textContent).toContain("text · Tab or list");
    expect(info.textContent).toContain("Tab insert");
  });

  it("offers Edit snippet only when the port can open it", () => {
    const editSnippet = vi.fn();
    const port = portWith(ENTRIES, { editSnippet });
    const record = port.library().byId("paper.theorem");
    if (!record) throw new Error("missing record");
    const info = snippetInfo(record, port, "latex");
    const button = info.querySelector("button");
    expect(button?.textContent).toBe("Edit snippet");
    const press = new MouseEvent("mousedown", { cancelable: true });
    button?.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    button?.click();
    expect(editSnippet).toHaveBeenCalledWith("paper.theorem");
    expect(snippetInfo(record, portWith(ENTRIES), "latex").querySelector("button")).toBeNull();
  });

  it("leaves the preview out for a record without a body", () => {
    const port = portWith(ENTRIES);
    const record = { ...(port.library().byId("paper.theorem") as never as object), bodies: {} };
    expect(snippetInfo(record as never, port, "latex").querySelector("pre")).toBeNull();
  });

  it("names every place and expand mode", () => {
    const port = portWith({
      a: { prefix: "a", body: "a", where: "any" },
      b: { prefix: "b", body: "b", where: "inline-math", expand: "auto" },
      c: { prefix: "c", body: "c", where: "display-math" },
      d: { prefix: "d", body: "d", where: "code" },
    });
    const meta = (id: string) =>
      snippetInfo(port.library().byId(id) as never, port, "latex").querySelector("div:nth-child(2)")?.textContent;
    expect(meta("a")).toBe("anywhere · Tab or list");
    expect(meta("b")).toBe("inline math · as you type");
    expect(meta("c")).toBe("display math · Tab or list");
    expect(meta("d")).toBe("code · Tab or list");
  });
});

describe("snippet fields own the list", () => {
  it("lists the choices of a choice field and silences the other sources", () => {
    const port = portWith(ENTRIES);
    const view = snippetEditor("fig|", { port, extensions: [latexLanguage()] });
    insertSnippet(view, port.library().byId("paper.figure") as never, 0, 3, "tab");
    expect(activeSnippetField(view.state)?.choices).toEqual(["htbp", "t", "b", "H"]);
    const other = vi.fn<CompletionSource>(() => null);
    const [first, wrapped] = withSnippetCompletions([other]);
    const context = new CompletionContext(view.state, view.state.selection.main.head, true);
    expect(labels(first(context) as CompletionResult)).toEqual(["htbp", "t", "b", "H"]);
    expect(wrapped(context)).toBeNull();
    expect(other).not.toHaveBeenCalled();
  });

  it("lets the other sources run outside a list field", () => {
    const view = latexEditor("plain|");
    const other = vi.fn<CompletionSource>(() => null);
    const [, wrapped] = withSnippetCompletions([other]);
    wrapped(new CompletionContext(view.state, 5, true));
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe("the completion popup", () => {
  async function popupAfter(marked: string, typed: string, language: "latex" | "typst" | "markdown") {
    const port = portWith(
      {
        ...ENTRIES,
        "typst.slash.heading": { name: "Heading", prefix: "/heading", body: "= $1", expand: "list", languages: ["typst"], where: "text" },
        "markdown.slash.table": { name: "Table", prefix: "/table", body: "| $1 |", expand: "list", languages: ["markdown"], where: "text" },
      },
      { language: () => language },
    );
    const languageExtension = { latex: latexLanguage, typst: typstLanguage, markdown: markdownLanguage }[language]();
    const view = snippetEditor(marked, {
      port,
      extensions: [
        languageExtension,
        autocompletion({ override: withSnippetCompletions([]), activateOnTyping: true, activateOnTypingDelay: 0 }),
      ],
    });
    for (const character of typed) input(view, character);
    await vi.waitFor(() => expect(completionStatus(view.state)).toBe("active"));
    return currentCompletions(view.state).map((completion) => completion.label);
  }

  it("opens while typing a slash in each language", async () => {
    expect(await popupAfter("Intro\n|", "/sec", "latex")).toEqual(["/section"]);
    expect(await popupAfter("Intro\n|", "/he", "typst")).toEqual(["/heading"]);
    expect(await popupAfter("Intro\n|", "/ta", "markdown")).toEqual(["/table"]);
  });
});
