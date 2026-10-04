// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletionContext, type Completion, type CompletionResult } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import { useFilesStore } from "@/store/files";

const corpus = vi.hoisted(() => ({
  corpusPackageNames: vi.fn((): { names: string[] } | null => ({ names: ["amsmath"] })),
  corpusClassNames: vi.fn((): { names: string[] } | null => ({ names: ["article"] })),
}));

vi.mock("@/lib/latex-corpus", () => corpus);

import { languageServiceCompletion } from "./language-service";

const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

const requestCompletion = vi.fn();
const supports = vi.fn((_feature: string) => true);
let deactivate: (() => void) | null = null;
let views: EditorView[] = [];

function activate(text: string, active = "main.tex") {
  useFilesStore.setState({
    projectId: "project-ls",
    activePath: active,
    files: { [active]: { content: text, dirty: false } },
  });
  deactivate = activateInteractiveLanguageService({
    owner: {},
    projectId: "project-ls",
    projectRevision: 1,
    kind: active.endsWith(".typ") ? "tinymist" : "texlab",
    positionEncoding: "utf-16",
    client: {
      generation: 1,
      workspaceRoot: "/project",
      supports,
      capabilities: { completionTriggerCharacters: ["#"] },
      requestCompletion,
    } as unknown as LanguageServiceClient,
    documentForPath: (path) =>
      path === active ? { path, uri: `file:///project/${active}`, text, version: 1 } : null,
  });
}

async function complete(text: string, pos = text.length, explicit = true) {
  return languageServiceCompletion(
    new CompletionContext(EditorState.create({ doc: text }), pos, explicit),
  );
}

function editor(text: string, selection?: EditorSelection): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: selection ?? EditorSelection.cursor(text.length),
      extensions: EditorState.allowMultipleSelections.of(true),
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

function optionsOf(result: CompletionResult | null): readonly Completion[] {
  if (!result) throw new Error("expected completion options");
  return result.options;
}

function apply(view: EditorView, option: Completion) {
  const run = option.apply;
  if (typeof run !== "function") throw new Error("expected an apply function");
  run(view, option, 0, 0);
}

beforeEach(() => {
  requestCompletion.mockReset();
  supports.mockReset();
  supports.mockReturnValue(true);
  corpus.corpusPackageNames.mockReturnValue({ names: ["amsmath"] });
  corpus.corpusClassNames.mockReturnValue({ names: ["article"] });
});

afterEach(() => {
  deactivate?.();
  deactivate = null;
  for (const view of views) view.destroy();
  views = [];
});

describe("when the language service is not asked", () => {
  it("skips files the language service does not handle", async () => {
    activate("\\sec", "notes.md");
    await expect(complete("\\sec")).resolves.toBeNull();
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("skips implicit LaTeX completion outside a command or argument", async () => {
    activate("plain words");
    await expect(complete("plain words", 11, false)).resolves.toBeNull();
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("asks implicitly inside a command and inside a package argument", async () => {
    requestCompletion.mockResolvedValue([{ label: "section" }]);
    activate("\\sec");
    await expect(complete("\\sec", 4, false)).resolves.not.toBeNull();
    deactivate?.();
    activate("\\usepackage[x]{gra");
    await complete("\\usepackage[x]{gra", 18, false);
    expect(requestCompletion).toHaveBeenCalledTimes(2);
    expect(requestCompletion.mock.calls[0][0].context).toEqual({ triggerKind: 1 });
  });

  it("skips a client that does not support completion", async () => {
    activate("\\sec");
    supports.mockReturnValue(false);
    await expect(complete("\\sec")).resolves.toBeNull();
    expect(requestCompletion).not.toHaveBeenCalled();
  });

  it("returns nothing when the request fails or goes stale", async () => {
    activate("\\sec");
    requestCompletion.mockRejectedValueOnce(new Error("starting"));
    await expect(complete("\\sec")).resolves.toBeNull();

    requestCompletion.mockImplementationOnce(async () => {
      useFilesStore.setState({
        files: { "main.tex": { content: "\\section", dirty: true } },
      });
      return [{ label: "section" }];
    });
    await expect(complete("\\sec")).resolves.toBeNull();
  });

  it("returns nothing for an empty or malformed answer", async () => {
    activate("\\sec");
    requestCompletion.mockResolvedValueOnce({ items: "nope" });
    await expect(complete("\\sec")).resolves.toBeNull();
    requestCompletion.mockResolvedValueOnce(42);
    await expect(complete("\\sec")).resolves.toBeNull();
  });
});

describe("normalising completion items", () => {
  it("maps LSP kinds onto CodeMirror completion types", async () => {
    activate("\\x");
    const kinds = [2, 3, 4, 5, 22, 6, 8, 10, 7, 9, 12, 13, 21, 14, 15, 17, 18, 19, 20, 23, 24, 1];
    requestCompletion.mockResolvedValue(
      kinds.map((kind) => ({ label: `k${kind}`, kind })),
    );
    const result = await complete("\\x");
    expect(result?.options.map((option) => option.type)).toEqual([
      "function",
      "function",
      "function",
      "type",
      "type",
      "variable",
      "variable",
      "variable",
      "class",
      "namespace",
      "property",
      "constant",
      "constant",
      "keyword",
      "snippet",
      "text",
      "text",
      "text",
      "variable",
      "type",
      "type",
      undefined,
    ]);
  });

  it("trims the package extension from details and reads documentation", async () => {
    activate("\\x");
    requestCompletion.mockResolvedValue({
      items: [
        { label: "a", detail: "amsmath.sty", documentation: "Plain docs" },
        { label: "b", detail: 7, documentation: { kind: "markdown", value: "**Rich**" } },
        { label: "c", detail: "\0", documentation: 3 },
        { label: "d", documentation: { kind: "markdown", value: 5 } },
      ],
    });
    const result = await complete("\\x");
    expect(
      result?.options.map(({ label, detail, info }) => ({ label, detail, info })),
    ).toEqual([
      { label: "a", detail: "amsmath", info: "Plain docs" },
      { label: "b", detail: undefined, info: "**Rich**" },
      { label: "c", detail: undefined, info: undefined },
      { label: "d", detail: undefined, info: undefined },
    ]);
  });

  it("boosts server-sorted items in order and leaves unsorted ones alone", async () => {
    activate("\\x");
    requestCompletion.mockResolvedValue([
      { label: "first", sortText: "0" },
      { label: "second", sortText: "1" },
      { label: "third" },
    ]);
    const result = await complete("\\x");
    expect(result?.options.map((option) => option.boost)).toEqual([99, 98, undefined]);
  });

  it("drops unlabelled and duplicate items", async () => {
    activate("\\x");
    requestCompletion.mockResolvedValue([
      { label: "" },
      { label: "\0" },
      { kind: 3 },
      { label: "dup" },
      { label: "dup" },
      { label: "dup", insertText: "dup2" },
    ]);
    const result = await complete("\\x");
    expect(result?.options.map((option) => option.label)).toEqual(["dup", "dup"]);
  });

  it("caps the list at five hundred items", async () => {
    activate("\\x");
    requestCompletion.mockResolvedValue(
      Array.from({ length: 520 }, (_, index) => ({ label: `item${index}` })),
    );
    const result = await complete("\\x");
    expect(result?.options).toHaveLength(500);
  });

  it("hides standard environments inside \\begin and stops boosting there", async () => {
    const text = "\\begin{ite";
    activate(text);
    requestCompletion.mockResolvedValue([
      { label: "itemize", sortText: "0" },
      { label: "myenv", sortText: "1" },
    ]);
    const result = await complete(text);
    expect(result?.options.map(({ label, boost }) => ({ label, boost }))).toEqual([
      { label: "myenv", boost: undefined },
    ]);
  });

  it("keeps only project-local packages inside \\usepackage", async () => {
    const text = "\\usepackage{ams";
    activate(text);
    requestCompletion.mockResolvedValue([
      { label: ".git" },
      { label: "amsmath" },
      { label: "mystyle" },
    ]);
    const result = await complete(text);
    expect(result?.options.map((option) => option.label)).toEqual(["mystyle"]);
    expect(corpus.corpusPackageNames).toHaveBeenCalled();
    expect(corpus.corpusClassNames).not.toHaveBeenCalled();
  });

  it("filters classes inside \\documentclass and copes with a missing corpus", async () => {
    const text = "\\documentclass[a4paper]{art";
    activate(text);
    requestCompletion.mockResolvedValue([
      { label: "article" },
      { label: ".vscode" },
      { label: "thesis" },
    ]);
    let result = await complete(text);
    expect(result?.options.map((option) => option.label)).toEqual(["thesis"]);

    corpus.corpusClassNames.mockReturnValue(null);
    result = await complete(text);
    expect(result?.options.map((option) => option.label)).toEqual(["article", "thesis"]);
  });

  it("returns null when the argument filter removes every item", async () => {
    const text = "\\usepackage{ams";
    activate(text);
    requestCompletion.mockResolvedValue([{ label: "amsmath" }]);
    await expect(complete(text)).resolves.toBeNull();
  });
});

describe("applying a completion", () => {
  it("replaces the server range with plain text", async () => {
    const text = "see \\sec";
    activate(text);
    requestCompletion.mockResolvedValue([
      { label: "section", textEdit: { newText: "\\section", range: range(0, 4, 8) } },
    ]);
    const result = await complete(text);
    const view = editor(text);
    apply(view, optionsOf(result)[0]);
    expect(view.state.doc.toString()).toBe("see \\section");
  });

  it("accepts an insert/replace edit and falls back for broken ranges", async () => {
    const text = "\\sec";
    activate(text);
    requestCompletion.mockResolvedValue([
      {
        label: "one",
        textEdit: { newText: "\\one", insert: range(0, 0, 4), replace: range(0, 0, 4) },
      },
      { label: "two", textEdit: { newText: "\\two", range: range(0, 3, 1) } },
      { label: "three", textEdit: { newText: "\\three", range: { start: { line: -1, character: 0 }, end: { line: 0, character: 1 } } } },
      { label: "four", textEdit: { newText: "\\four", range: { start: { line: 0.5, character: 0 }, end: { line: 0, character: 1 } } } },
      { label: "five", textEdit: { newText: "\\five", range: { start: { line: 0 }, end: { line: 0, character: 1 } } } },
      { label: "six", textEdit: { newText: "\\six", range: "bad" } },
      { label: "seven", textEdit: { newText: 7, range: range(0, 0, 4) } },
    ]);
    const result = await complete(text);
    expect(result?.from).toBe(0);
    const outcomes = optionsOf(result).map((option) => {
      const view = editor(text);
      apply(view, option);
      return view.state.doc.toString();
    });
    expect(outcomes).toEqual(["\\one", "two", "three", "four", "five", "six", "seven"]);
  });

  it("expands an LSP snippet into a CodeMirror snippet", async () => {
    const text = "\\fr";
    activate(text);
    requestCompletion.mockResolvedValue([
      {
        label: "frac",
        insertTextFormat: 2,
        insertText: ["\\frac{", "$", "{1|num,top|}}{", "$", "2}"].join(""),
      },
    ]);
    const result = await complete(text);
    const view = editor(text);
    apply(view, optionsOf(result)[0]);
    expect(view.state.doc.toString()).toBe("\\frac{num}{}");
  });

  it("writes plain text for a snippet that brings additional edits", async () => {
    const text = "\\fr";
    activate(text);
    const snippetText = [
      "a\\",
      "$b ",
      "$",
      "{1:def} ",
      "$",
      "{2|one,two|} ",
      "$",
      "3 ",
      "$",
      "{4} ",
      "$",
      "{5|bad} ",
      "$x \\} \\\\ \\n ",
      "$",
      "{6:open",
    ].join("");
    requestCompletion.mockResolvedValue([
      {
        label: "snip",
        insertTextFormat: 2,
        textEdit: { newText: snippetText, range: range(0, 0, 3) },
        additionalTextEdits: [
          { newText: "% header\n", range: range(0, 0, 0) },
          { newText: "ignored", range: "bad" },
        ],
      },
    ]);
    const result = await complete(text);
    const view = editor(text);
    apply(view, optionsOf(result)[0]);
    expect(view.state.doc.toString()).toBe(
      ["% header\na$b def one   ", " $x } \\ \\n ", "$", "{6:open"].join(""),
    );
  });

  it("keeps a trailing dollar sign and a trailing backslash as text", async () => {
    const text = "\\fr";
    activate(text);
    requestCompletion.mockResolvedValue([
      { label: "a", insertTextFormat: 2, insertText: "x$", additionalTextEdits: [{ newText: "%", range: range(0, 0, 0) }] },
      { label: "b", insertTextFormat: 2, insertText: "y\\", additionalTextEdits: [{ newText: "%", range: range(0, 0, 0) }] },
    ]);
    const result = await complete(text);
    const outcomes = optionsOf(result).map((option) => {
      const view = editor(text);
      apply(view, option);
      return view.state.doc.toString();
    });
    expect(outcomes).toEqual(["%x$", "%y\\"]);
  });

  it("refuses overlapping or duplicate edits", async () => {
    const text = "\\sec";
    activate(text);
    requestCompletion.mockResolvedValue([
      {
        label: "overlap",
        textEdit: { newText: "\\section", range: range(0, 0, 4) },
        additionalTextEdits: [{ newText: "x", range: range(0, 2, 3) }],
      },
      {
        label: "same",
        textEdit: { newText: "\\section", range: range(0, 0, 0) },
        additionalTextEdits: [{ newText: "y", range: range(0, 0, 0) }],
      },
    ]);
    const result = await complete(text);
    for (const option of optionsOf(result)) {
      const view = editor(text);
      apply(view, option);
      expect(view.state.doc.toString()).toBe(text);
    }
  });

  it("does nothing once the document has changed", async () => {
    const text = "\\sec";
    activate(text);
    requestCompletion.mockResolvedValue([{ label: "section", insertText: "\\section" }]);
    const result = await complete(text);
    const changed = editor("\\sect");
    apply(changed, optionsOf(result)[0]);
    expect(changed.state.doc.toString()).toBe("\\sect");

    const view = editor(text);
    useFilesStore.setState({ files: { "main.tex": { content: "other", dirty: true } } });
    apply(view, optionsOf(result)[0]);
    expect(view.state.doc.toString()).toBe(text);
  });

  it("inserts at every cursor when several are active", async () => {
    const text = "x\nx";
    activate(text);
    requestCompletion.mockResolvedValue([
      { label: "xy", textEdit: { newText: "xy", range: range(1, 0, 1) } },
    ]);
    const result = await complete(text);
    const view = editor(
      text,
      EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)], 1),
    );
    apply(view, optionsOf(result)[0]);
    expect(view.state.doc.toString()).toBe("xy\nxy");
  });
});
