// @vitest-environment jsdom

import {
  autocompletion,
  completionKeymap,
  completionStatus,
  selectedCompletion,
  snippet,
  startCompletion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEditorDocumentPath } from "./controller";
import {
  closeEnvironmentOnEnter,
  environmentSnippet,
  openEnvironmentCompletion,
} from "./latex-environments";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const views: EditorView[] = [];

beforeEach(() => {
  setEditorDocumentPath("/project/main.tex");
});

afterEach(() => {
  setEditorDocumentPath(null);
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
});

function split(markedDoc: string): { doc: string; cursor: number } {
  const cursor = markedDoc.indexOf("|");
  if (cursor < 0) throw new Error("missing | cursor marker");
  return {
    doc: markedDoc.slice(0, cursor) + markedDoc.slice(cursor + 1),
    cursor,
  };
}

function editor(markedDoc: string, extensions: Extension[] = []): EditorView {
  const { doc, cursor } = split(markedDoc);
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(cursor),
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        indentUnit.of("  "),
        ...extensions,
      ],
    }),
  });
  views.push(view);
  return view;
}

function marked(target: EditorView): string {
  const head = target.state.selection.main.head;
  return `${target.state.sliceDoc(0, head)}|${target.state.sliceDoc(head)}`;
}

function press(target: EditorView, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.contentDOM.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("environmentSnippet", () => {
  function insert(name: string, at = "\\begin{"): EditorView {
    const target = editor(`${at}|`);
    snippet(environmentSnippet(name))(
      target,
      null,
      target.state.doc.length,
      target.state.doc.length,
    );
    return target;
  }

  function applied(name: string): string {
    return marked(insert(name));
  }

  function appliedText(name: string): string {
    return insert(name).state.doc.toString();
  }

  it("seeds an item for bulleted and numbered lists", () => {
    expect(applied("itemize")).toBe(
      "\\begin{itemize}\n  \\item |\n\\end{itemize}",
    );
    expect(applied("enumerate")).toBe(
      "\\begin{enumerate}\n  \\item |\n\\end{enumerate}",
    );
  });

  it("seeds a labelled item for description lists", () => {
    expect(applied("description")).toBe(
      "\\begin{description}\n  \\item[|] \n\\end{description}",
    );
  });

  it("builds a float skeleton for figures", () => {
    expect(applied("figure")).toBe(
      "\\begin{figure}[htbp|]\n" +
        "  \\centering\n" +
        "  \n" +
        "  \\caption{}\n" +
        "  \\label{}\n" +
        "\\end{figure}",
    );
  });

  it("builds a float skeleton with a tabular body for tables", () => {
    expect(applied("table")).toBe(
      "\\begin{table}[htbp|]\n" +
        "  \\centering\n" +
        "  \\caption{}\n" +
        "  \\label{}\n" +
        "  \\begin{tabular}{ll}\n" +
        "    \n" +
        "  \\end{tabular}\n" +
        "\\end{table}",
    );
  });

  it("seeds a column specification for a bare tabular", () => {
    expect(applied("tabular")).toBe(
      "\\begin{tabular}{ll|}\n  \n\\end{tabular}",
    );
  });

  it("leaves table variants with their own argument shapes alone", () => {
    expect(applied("tabularx")).toBe(
      "\\begin{tabularx}\n  |\n\\end{tabularx}",
    );
    expect(applied("tabular*")).toBe(
      "\\begin{tabular*}\n  |\n\\end{tabular*}",
    );
  });

  it("selects the first field of a skeleton that carries a default", () => {
    const target = insert("figure");
    expect(target.state.selection.main.empty).toBe(false);
    expect(
      target.state.sliceDoc(
        target.state.selection.main.from,
        target.state.selection.main.to,
      ),
    ).toBe("htbp");
  });

  it("keeps the starred name while reusing the skeleton", () => {
    expect(appliedText("figure*")).toContain("\\begin{figure*}[htbp]");
    expect(appliedText("figure*")).toContain("\\end{figure*}");
    expect(applied("align*")).toBe("\\begin{align*}\n  |\n\\end{align*}");
  });

  it("falls back to an indented body for any other environment", () => {
    expect(applied("theorem")).toBe(
      "\\begin{theorem}\n  |\n\\end{theorem}",
    );
  });

  it("indents the body relative to the begin line", () => {
    const target = editor("  \\begin{|");
    snippet(environmentSnippet("quote"))(
      target,
      null,
      target.state.doc.length,
      target.state.doc.length,
    );
    expect(target.state.doc.toString()).toBe(
      "  \\begin{quote}\n    \n  \\end{quote}",
    );
  });
});

describe("closeEnvironmentOnEnter", () => {
  function pressEnter(markedDoc: string, extensions: Extension[] = []) {
    const target = editor(markedDoc, extensions);
    const handled = closeEnvironmentOnEnter(target);
    return { handled, text: marked(target) };
  }

  it("closes an unclosed environment on its own indented line", () => {
    expect(pressEnter("\\begin{center}|")).toEqual({
      handled: true,
      text: "\\begin{center}\n  |\n\\end{center}",
    });
  });

  it("seeds an item for list environments", () => {
    expect(pressEnter("\\begin{itemize}|")).toEqual({
      handled: true,
      text: "\\begin{itemize}\n  \\item |\n\\end{itemize}",
    });
  });

  it("seeds a labelled item for description lists", () => {
    expect(pressEnter("\\begin{description}|")).toEqual({
      handled: true,
      text: "\\begin{description}\n  \\item[|] \n\\end{description}",
    });
  });

  it("keeps the begin line's indentation", () => {
    expect(pressEnter("    \\begin{quote}|")).toEqual({
      handled: true,
      text: "    \\begin{quote}\n      |\n    \\end{quote}",
    });
  });

  it("declines when the environment is already closed", () => {
    expect(pressEnter("\\begin{itemize}|\n\\end{itemize}")).toEqual({
      handled: false,
      text: "\\begin{itemize}|\n\\end{itemize}",
    });
  });

  it("declines when the matching end closes a deeper copy first", () => {
    expect(
      pressEnter(
        "\\begin{itemize}|\n\\begin{itemize}\n\\end{itemize}\n\\end{itemize}",
      ).handled,
    ).toBe(false);
  });

  it("closes only the inner environment of a nested pair", () => {
    expect(
      pressEnter(
        "\\begin{itemize}\n  \\item a\n  \\begin{itemize}|\n\\end{itemize}",
      ),
    ).toEqual({
      handled: true,
      text:
        "\\begin{itemize}\n  \\item a\n  \\begin{itemize}\n" +
        "    \\item |\n  \\end{itemize}\n\\end{itemize}",
    });
  });

  it("ignores a closer that sits outside the enclosing environment", () => {
    expect(
      pressEnter(
        "\\begin{quote}\n\\begin{itemize}|\n\\end{quote}\n\\end{itemize}",
      ),
    ).toEqual({
      handled: true,
      text:
        "\\begin{quote}\n\\begin{itemize}\n  \\item |\n\\end{itemize}\n" +
        "\\end{quote}\n\\end{itemize}",
    });
  });

  it("swallows trailing whitespace after the begin", () => {
    expect(pressEnter("\\begin{quote}   |")).toEqual({
      handled: true,
      text: "\\begin{quote}\n  |\n\\end{quote}",
    });
  });

  it("keeps a trailing comment on the begin line", () => {
    expect(pressEnter("\\begin{quote} % preserve this|")).toEqual({
      handled: true,
      text: "\\begin{quote} % preserve this\n  |\n\\end{quote}",
    });
  });

  it("declines when the tail reaches past the validated line window", () => {
    const padding = " ".repeat(2_050);
    const doc = `\\begin{quote}|${padding}KEEP ME`;
    expect(pressEnter(doc)).toEqual({ handled: false, text: doc });
  });

  it("never closes the document environment", () => {
    expect(pressEnter("\\begin{document}|")).toEqual({
      handled: false,
      text: "\\begin{document}|",
    });
  });

  const declines: { name: string; doc: string }[] = [
    { name: "text follows the cursor", doc: "\\begin{quote}|x" },
    { name: "the line has no begin", doc: "plain text|" },
    { name: "the begin is inside a comment", doc: "% \\begin{quote}|" },
    { name: "the environment name is empty", doc: "\\begin{}|" },
    {
      name: "the begin is inside verbatim",
      doc: "\\begin{verbatim}\n\\begin{quote}|\n\\end{verbatim}",
    },
  ];

  it.each(declines)("declines when $name", ({ doc }) => {
    expect(pressEnter(doc)).toEqual({ handled: false, text: doc });
  });

  it("declines for a non-empty selection", () => {
    const target = editor("\\begin{quote}|");
    target.dispatch({ selection: EditorSelection.single(0, 6) });
    expect(closeEnvironmentOnEnter(target)).toBe(false);
  });

  it("declines for non-LaTeX documents", () => {
    setEditorDocumentPath("/project/notes.md");
    expect(pressEnter("\\begin{itemize}|")).toEqual({
      handled: false,
      text: "\\begin{itemize}|",
    });
  });

  it("stops looking for the closer at the forward scan bound", () => {
    const filler = "padding line\n".repeat(400);
    expect(filler.length).toBeGreaterThan(4 * 1024);
    const result = pressEnter(
      `\\begin{quote}|\n${filler}\\end{quote}`,
    );
    expect(result.handled).toBe(true);
    expect(result.text.startsWith("\\begin{quote}\n  |\n\\end{quote}\n")).toBe(
      true,
    );
  });

  const completionSource: CompletionSource = (context) => ({
    from: context.pos,
    options: [{ label: "izzy" }],
    filter: false,
  });

  function completionEditor(markedDoc: string, interactionDelay: number) {
    return editor(markedDoc, [
      autocompletion({
        override: [completionSource],
        defaultKeymap: false,
        interactionDelay,
      }),
      keymap.of([
        ...completionKeymap,
        { key: "Enter", run: closeEnvironmentOnEnter },
        ...defaultKeymap,
      ]),
    ]);
  }

  it("lets the completion popup accept Enter when it is ready", async () => {
    const target = completionEditor("\\begin{itemize}|", 0);
    startCompletion(target);
    await vi.waitFor(() =>
      expect(selectedCompletion(target.state)).not.toBeNull(),
    );
    expect(press(target, "Enter")).toBe(true);
    expect(target.state.doc.toString()).toBe("\\begin{itemize}izzy");
  });

  it("closes the environment when the popup declines Enter", async () => {
    const target = completionEditor("\\begin{itemize}|", 10_000);
    startCompletion(target);
    await vi.waitFor(() =>
      expect(selectedCompletion(target.state)).not.toBeNull(),
    );
    expect(press(target, "Enter")).toBe(true);
    expect(target.state.doc.toString()).toBe(
      "\\begin{itemize}\n  \\item \n\\end{itemize}",
    );
  });
});

describe("openEnvironmentCompletion", () => {
  const source: CompletionSource = () => ({
    from: 0,
    options: [{ label: "itemize" }],
  });

  it("starts completion when the caret lands in empty begin braces", async () => {
    const target = editor("x|\n\\begin{}", [
      autocompletion({ override: [source] }),
      openEnvironmentCompletion,
    ]);
    target.dispatch({
      selection: { anchor: target.state.doc.length - 1 },
    });
    await vi.waitFor(() =>
      expect(completionStatus(target.state)).not.toBeNull(),
    );
  });

  it("leaves completion closed elsewhere", async () => {
    const target = editor("\\begin{itemize}|", [
      autocompletion({ override: [source] }),
      openEnvironmentCompletion,
    ]);
    target.dispatch({ selection: { anchor: 3 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(completionStatus(target.state)).toBeNull();
  });
});
