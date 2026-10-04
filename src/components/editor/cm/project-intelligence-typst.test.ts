// @vitest-environment jsdom

import {
  CompletionContext,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath } from "@oleafly/editor";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import {
  editorCompletionSourcesForPath,
  mergeCompletionResults,
  projectIntelligenceCompletion,
  typstCompletionWithLanguageService,
} from "./project-intelligence";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
}

const views: EditorView[] = [];

function snapshot(
  sources: Readonly<Record<string, string>>,
  mainDocument: string,
): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [
      path,
      analyzeProjectFile(path, source, 1),
    ]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: "typst-project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument,
    stats: {
      fileCount: Object.keys(files).length,
      characterCount: 0,
      parsedFileCount: Object.keys(files).length,
      reusedFileCount: 0,
      durationMs: 0,
    },
  });
}

function install(
  sources: Readonly<Record<string, string>>,
  active: string,
  extraFiles: readonly string[] = [],
): void {
  const value = snapshot(sources, active);
  useFilesStore.setState({
    projectId: "typst-project",
    activePath: active,
    tree: [...Object.keys(sources), ...extraFiles].map((path) => ({
      path,
      is_dir: false,
    })),
    files: Object.fromEntries(
      Object.entries(sources).map(([path, content]) => [path, { content, dirty: false }]),
    ),
  });
  useIndexStore.setState({
    texts: { ...sources },
    intelligenceState: {
      status: "success",
      identity: value.identity,
      data: value,
      stale: false,
    },
  });
  setEditorDocumentPath(active);
}

function viewFor(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: doc.length } }),
  });
  views.push(view);
  return view;
}

function completeIn(view: EditorView, explicit = false): CompletionResult | null {
  const value = projectIntelligenceCompletion(
    new CompletionContext(view.state, view.state.selection.main.head, explicit),
  );
  if (value && typeof (value as Promise<unknown>).then === "function") {
    throw new Error("expected a synchronous result");
  }
  return value as CompletionResult | null;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => String(option.label));
}

function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

function accept(view: EditorView, result: CompletionResult | null, label: string): string {
  if (!result) throw new Error(`no completion for ${label}`);
  const option = result.options.find((candidate) => candidate.label === label);
  if (typeof option?.apply !== "function") throw new Error(`missing ${label}`);
  option.apply(view, option, result.from, view.state.selection.main.head);
  return view.state.doc.toString();
}

afterEach(() => {
  while (views.length > 0) views.pop()?.destroy();
  document.body.replaceChildren();
  setEditorDocumentPath(null);
  useIndexStore.getState().reset();
  useFilesStore.setState({ projectId: null, activePath: null, files: {}, tree: [] });
});

describe("Typst binding completion", () => {
  const lib = "#let helper(x, y, scale: 1) = x + y\n#let accent = red\n";

  it("offers project functions with their parameter list", () => {
    const main = '#import "lib.typ": *\n#let note(body, color: red) = box(body)\n#hel';
    install({ "main.typ": main, "lib.typ": lib }, "main.typ");
    const view = viewFor(main);
    const result = completeIn(view);
    const helper = result?.options.find((option) => option.label === "helper");
    expect(helper?.type).toBe("function");
    expect(helper?.detail).toContain("(x, y, scale: 1)");
    expect(helper?.detail).toContain("lib.typ:1");
    expect(accept(view, result, "helper")).toBe(`${main.slice(0, -3)}helper(x, y)`);
  });

  it("inserts a variable binding by name", () => {
    const main = "#ac";
    install({ "main.typ": main, "lib.typ": lib }, "main.typ");
    const view = viewFor(main);
    const result = completeIn(view);
    const accent = result?.options.find((option) => option.label === "accent");
    expect(accent?.type).toBe("variable");
    expect(accept(view, result, "accent")).toBe("#accent");
  });

  it("does not repeat the call parentheses that already follow", () => {
    const main = "#let note(body) = body\n#no(x)";
    install({ "main.typ": main }, "main.typ");
    const view = viewFor(main);
    view.dispatch({ selection: { anchor: main.length - 3 } });
    const result = completeIn(view);
    expect(accept(view, result, "note")).toBe("#let note(body) = body\n#note(x)");
  });

  it("keeps strings and nested groups whole and drops a trailing comma from the parameters", () => {
    const main = [
      String.raw`#let plot(data, opts: (a: 1, b: "x, y"), label: "q\"(",`,
      "  axis ,",
      ") = data",
      "#plo",
    ].join("\n");
    install({ "main.typ": main }, "main.typ");
    const view = viewFor(main);
    const result = completeIn(view);
    const plot = result?.options.find((option) => option.label === "plot");
    expect(plot?.detail).toBe(
      String.raw`(data, opts: (a: 1, b: "x, y"), label: "q\"(", axis) · main.typ:1`,
    );
    expect(accept(view, result, "plot")).toBe(`${main.slice(0, -3)}plot(data, axis)`);
  });

  it("keeps LaTeX macros out of Typst completion", () => {
    const main = "#no";
    install({ "main.typ": main, "paper.tex": String.raw`\newcommand{\nob}{x}` }, "main.typ");
    expect(labels(completeIn(viewFor(main)))).not.toContain("nob");
  });

  it("offers bindings from the current text before the index catches up", () => {
    install({ "main.typ": "Intro\n", "lib.typ": lib }, "main.typ");
    const doc = "Intro\n#let fresh(a) = a\n#fr";
    const result = completeIn(viewFor(doc));
    expect(labels(result)).toContain("fresh");
    expect(labels(completeIn(viewFor("Intro\n#hel")))).toContain("helper");
  });
});

describe("Typst file path completion", () => {
  const files = [
    "figures/a.png",
    "figures/b.svg",
    "data/table.csv",
    "data/config.json",
    "refs.bib",
    "chapters/intro.typ",
    "notes.txt",
    "plugin.wasm",
    ".oleafly/build/main.pdf",
  ];

  function pathsFor(doc: string, active = "main.typ"): string[] {
    install({ [active]: doc }, active, files.filter((file) => file !== active));
    return labels(completeIn(viewFor(doc)));
  }

  it.each([
    ['#image("', ["figures/a.png", "figures/b.svg"]],
    ['#csv("', ["data/table.csv"]],
    ['#json("', ["data/config.json"]],
    ['#bibliography("', ["refs.bib"]],
    ['#bibliography(("refs.bib", "', ["refs.bib"]],
    ['#include "', ["chapters/intro.typ"]],
    ['#import "', ["chapters/intro.typ"]],
    ['#plugin("', ["plugin.wasm"]],
    ['#image(  "', ["figures/a.png", "figures/b.svg"]],
    ['#bibliography( ( "refs.bib" , "x.bib",  "', ["refs.bib"]],
    ['#import  "', ["chapters/intro.typ"]],
  ])("filters %s by extension", (doc, expected) => {
    expect(pathsFor(doc).sort()).toEqual([...expected].sort());
  });

  it.each(['#ximage("', '#a.image("', '#Image("', '#include("', '#image(width: 1, "'])(
    "does not treat %s as a path argument",
    (doc) => {
      expect(pathsFor(doc)).not.toContain("figures/a.png");
    },
  );

  it("offers every readable file to read", () => {
    expect(pathsFor('#read("')).toEqual(
      expect.arrayContaining(["notes.txt", "data/table.csv", "refs.bib"]),
    );
    expect(pathsFor('#read("')).not.toContain(".oleafly/build/main.pdf");
  });

  it("writes paths relative to the current file, or from the root after a slash", () => {
    expect(pathsFor('#image("', "chapters/intro.typ")).toEqual(
      expect.arrayContaining(["../figures/a.png"]),
    );
    expect(pathsFor('#image("/')).toEqual(
      expect.arrayContaining(["/figures/a.png", "/figures/b.svg"]),
    );
  });

  it("replaces the typed prefix", () => {
    const doc = '#image("fig';
    install({ "main.typ": doc }, "main.typ", files);
    const view = viewFor(doc);
    const result = completeIn(view);
    expect(result?.from).toBe(doc.length - 3);
    expect(accept(view, result, "figures/a.png")).toBe('#image("figures/a.png');
  });

  it("works without a current index and stays out of packages and comments", () => {
    install({ "main.typ": "" }, "main.typ", files);
    expect(labels(completeIn(viewFor('#image("')))).toContain("figures/a.png");
    expect(completeIn(viewFor('#import "@preview/'))).toBeNull();
    expect(completeIn(viewFor('// #image("'))).toBeNull();
  });
});

describe("Typst label completion", () => {
  const bib = "@book{knuth84, title={T}}";

  it("offers labels after #ref(< in markup and in code", () => {
    const main = "= Intro <intro>\nSee #ref(<";
    install({ "main.typ": main, "refs.bib": bib }, "main.typ");
    expect(labels(completeIn(viewFor(main)))).toEqual(["intro"]);
    const code = "= Intro <intro>\n#{ ref(<";
    install({ "main.typ": code }, "main.typ");
    expect(labels(completeIn(viewFor(code)))).toEqual(["intro"]);
  });

  it("keeps labels and citations available while typing ahead of the index", () => {
    install(
      { "main.typ": "= Intro <intro>\n", "chapter.typ": "= Other <other>\n", "refs.bib": bib },
      "main.typ",
    );
    const doc = "= Intro <intro>\nNew <fresh>\nSee @";
    const found = labels(completeIn(viewFor(doc)));
    expect(found).toEqual(expect.arrayContaining(["intro", "fresh", "other", "knuth84"]));
  });
});

describe("Typst completion merged with the language server", () => {
  function result(from: number, names: string[], filter?: boolean): CompletionResult {
    return {
      from,
      options: names.map((label) => ({ label })),
      ...(filter === undefined ? {} : { filter }),
    };
  }

  it("keeps the language server first and drops local duplicates", () => {
    const merged = mergeCompletionResults(
      result(4, ["<intro>", "lsp-only"], false),
      result(5, ["intro", "fresh"], true),
    );
    expect(merged?.from).toBe(4);
    expect(merged?.filter).toBe(false);
    expect(labels(merged)).toEqual(["<intro>", "lsp-only", "fresh"]);
  });

  it("applies a local option from its own start", () => {
    const view = viewFor("See @fr");
    const merged = mergeCompletionResults(
      result(4, ["lsp-only"], false),
      { from: 5, options: [{ label: "fresh" } satisfies Completion] },
    );
    const combined = present(merged);
    const option = present(combined.options.find((candidate) => candidate.label === "fresh"));
    (option.apply as NonNullable<Exclude<Completion["apply"], string>>)(
      view,
      option,
      combined.from,
      view.state.doc.length,
    );
    expect(view.state.doc.toString()).toBe("See @fresh");
  });

  it("returns whichever side answered alone", () => {
    const local = result(5, ["fresh"], true);
    expect(mergeCompletionResults(null, local)).toBe(local);
    const remote = result(4, ["x"], false);
    expect(mergeCompletionResults(remote, null)).toBe(remote);
  });

  it("asks the language server and the project index once per query", async () => {
    install({ "main.typ": "= Intro <intro>\n= Other <other>\nSee @" }, "main.typ");
    const view = viewFor("= Intro <intro>\n= Other <other>\nSee @");
    let calls = 0;
    const languageService: CompletionSource = async (context) => {
      calls += 1;
      return { from: context.pos - 1, options: [{ label: "@intro" }], filter: false };
    };
    const source = typstCompletionWithLanguageService(languageService);
    const merged = await source(
      new CompletionContext(view.state, view.state.doc.length, false),
    );
    expect(calls).toBe(1);
    expect(labels(merged)).toEqual(["@intro", "other"]);
  });

  it("routes a Typst file through one merged source", () => {
    const languageService: CompletionSource = () => null;
    expect(editorCompletionSourcesForPath("main.typ", languageService)).toHaveLength(1);
    expect(editorCompletionSourcesForPath("main.typ", languageService)[0]).toBe(
      editorCompletionSourcesForPath("other.typ", languageService)[0],
    );
    expect(editorCompletionSourcesForPath("main.tex", languageService)[0]).toBe(
      languageService,
    );
  });
});

describe("Typst completion edge cases", () => {
  it("writes a sibling path without climbing out of the shared folder", () => {
    const doc = '#image("';
    install({ "chapters/intro.typ": doc }, "chapters/intro.typ", ["chapters/figure.png", "chapters/deep/plot.png"]);
    expect(labels(completeIn(viewFor(doc))).sort()).toEqual(["deep/plot.png", "figure.png"]);
  });

  it("refuses to insert a path once the document moved on", () => {
    const doc = '#image("';
    install({ "main.typ": doc }, "main.typ", ["figures/a.png"]);
    const view = viewFor(doc);
    const result = present(completeIn(view));
    view.dispatch({ changes: { from: doc.length, insert: "x" } });
    const option = present(result.options.find((candidate) => candidate.label === "figures/a.png"));
    (option.apply as NonNullable<Exclude<Completion["apply"], string>>)(view, option, result.from, view.state.doc.length);
    expect(view.state.doc.toString()).toBe(`${doc}x`);
  });

  it("shows a binding whose parameter list never closes as a variable", () => {
    const main = '#let broken(a, b: "unterminated\n#bro';
    install({ "main.typ": main }, "main.typ");
    const broken = completeIn(viewFor(main))?.options.find((option) => option.label === "broken");
    expect(broken?.type).toBe("variable");
    expect(broken?.detail).toContain("Typst binding");
  });

  it("orders bindings from several files by name", () => {
    const lib = "#let alpha-lib = 1\n#let alpha = 2\n";
    const main = "#let alphabet = 3\n#al";
    install({ "main.typ": main, "lib.typ": lib }, "main.typ");
    expect(labels(completeIn(viewFor(main)))).toEqual(["alpha", "alpha-lib", "alphabet"]);
  });

  it("offers bindings on an explicit request inside code", () => {
    const main = "#let width = 1\n#{ let x = wi";
    install({ "main.typ": main }, "main.typ");
    expect(labels(completeIn(viewFor(main), true))).toContain("width");
    expect(completeIn(viewFor(main), false)).toBeNull();
  });

  it("offers citations inside an explicit #cite call", () => {
    const bib = "@book{knuth84, title={T}}";
    const main = "#cite(<kn";
    install({ "main.typ": main, "refs.bib": bib }, "main.typ");
    expect(labels(completeIn(viewFor(main)))).toEqual(["knuth84"]);
  });

  it("skips the current-file fallback for very large text and reuses it for the same text", () => {
    install({ "main.typ": "Intro\n", "lib.typ": "#let helper = 1\n" }, "main.typ");
    const huge = `${"x".repeat(100_001)}\n#hel`;
    expect(labels(completeIn(viewFor(huge)))).toEqual(["helper"]);
    const doc = "#let fresh = 1\n#fr";
    expect(labels(completeIn(viewFor(doc)))).toContain("fresh");
    expect(labels(completeIn(viewFor(doc)))).toContain("fresh");
  });
});
