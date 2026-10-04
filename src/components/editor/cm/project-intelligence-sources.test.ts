// @vitest-environment jsdom

import {
  CompletionContext,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { forceLinting, forEachDiagnostic, type Diagnostic } from "@codemirror/lint";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath } from "@oleafly/editor";
import type { CoreCatalog, NameList, PackageCatalog } from "@oleafly/latex-intelligence";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/intelligence.json" with { type: "json" };
import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import type { ProjectIntelligenceSnapshot } from "@/lib/project-intelligence/types";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";

const corpus = vi.hoisted(() => ({
  core: null as CoreCatalog | null,
  packageNames: null as NameList | null,
  classNames: null as NameList | null,
  catalogs: new Map<string, PackageCatalog>(),
  requestPackageCatalogs: vi.fn((_names: readonly string[]) => {}),
}));
const navigation = vi.hoisted(() => ({ navigateToProjectRange: vi.fn(async () => true) }));

vi.mock("@/lib/latex-corpus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/latex-corpus")>();
  return {
    ...actual,
    corpusCore: () => corpus.core,
    corpusPackageNames: () => corpus.packageNames,
    corpusClassNames: () => corpus.classNames,
    loadedCatalogsFor: (names: readonly string[]) =>
      new Map(names.flatMap((name) => {
        const catalog = corpus.catalogs.get(name);
        return catalog ? [[name, catalog] as const] : [];
      })),
    requestPackageCatalogs: corpus.requestPackageCatalogs,
  };
});
vi.mock("@/lib/project-intelligence/navigation", () => navigation);

import {
  completionInfoPanel,
  currentFileReferenceDiagnostics,
  editorCompletionSourcesForPath,
  mergeCompletionResults,
  projectCompletionSourcesForPath,
  projectIntelligenceCompletion,
  projectIntelligenceExtensions,
} from "./project-intelligence";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const PROJECT = "sources-project";
const completion = en.completion;
const views: EditorView[] = [];

function snapshot(sources: Readonly<Record<string, string>>, main = "main.tex"): ProjectIntelligenceSnapshot {
  const files = Object.fromEntries(
    Object.entries(sources).map(([path, source]) => [path, analyzeProjectFile(path, source, 1)]),
  );
  return assembleProjectIntelligence({
    identity: { projectId: PROJECT, projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: main,
    stats: { fileCount: 1, characterCount: 0, parsedFileCount: 1, reusedFileCount: 0, durationMs: 0 },
  });
}

function install(sources: Readonly<Record<string, string>>, active: string): ProjectIntelligenceSnapshot {
  const value = snapshot(sources);
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: active,
    tree: Object.keys(sources).map((path) => ({ path, is_dir: false })),
    files: Object.fromEntries(Object.entries(sources).map(([path, content]) => [path, { content, dirty: false }])),
  });
  useIndexStore.setState({
    texts: { ...sources },
    intelligenceState: { status: "success", identity: value.identity, data: value, stale: false },
  });
  setEditorDocumentPath(active);
  return value;
}

function complete(doc: string | EditorState, pos?: number, explicit = true): CompletionResult | null {
  const state = typeof doc === "string" ? EditorState.create({ doc }) : doc;
  const value = projectIntelligenceCompletion(new CompletionContext(state, pos ?? state.doc.length, explicit));
  if (value && typeof (value as Promise<unknown>).then === "function") throw new Error("expected sync");
  return value as CompletionResult | null;
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => String(option.label));
}

function option(result: CompletionResult | null, label: string): Completion {
  const found = result?.options.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`missing ${label}`);
  return found;
}

function view(doc: string, selection?: EditorSelection): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: selection ?? EditorSelection.cursor(doc.length),
      extensions: EditorState.allowMultipleSelections.of(true),
    }),
  });
  views.push(editor);
  return editor;
}

function applyOption(target: EditorView, result: CompletionResult, candidate: Completion, to = target.state.doc.length) {
  if (typeof candidate.apply !== "function") throw new Error("expected apply function");
  candidate.apply(target, candidate, result.from, to);
}

function infoDom(candidate: Completion): HTMLElement {
  if (typeof candidate.info !== "function") throw new Error("expected an info panel");
  return candidate.info(candidate) as HTMLElement;
}

beforeEach(() => {
  corpus.core = null;
  corpus.packageNames = null;
  corpus.classNames = null;
  corpus.catalogs = new Map();
  corpus.requestPackageCatalogs.mockClear();
  navigation.navigateToProjectRange.mockClear();
});

afterEach(() => {
  for (const editor of views.splice(0)) editor.destroy();
  setEditorDocumentPath(null);
  useIndexStore.getState().reset();
  useFilesStore.setState({ projectId: null, activePath: null, tree: [], files: {} });
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("completionInfoPanel", () => {
  it("returns nothing for an empty panel", () => {
    expect(completionInfoPanel({})).toBeUndefined();
  });

  it("builds a description, a muted meta line and a link", () => {
    const panel = completionInfoPanel({
      description: "Draws things.",
      meta: "from tikz",
      link: { href: "https://ctan.org/pkg/tikz", label: "ctan.org/pkg/tikz" },
    });
    const dom = (panel as () => HTMLElement)();
    const [description, meta] = [...dom.querySelectorAll("p")];
    expect(description.textContent).toBe("Draws things.");
    expect(meta.textContent).toBe("from tikz");
    expect(meta.style.opacity).toBe("0.75");
    const link = dom.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://ctan.org/pkg/tikz");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.textContent).toBe("ctan.org/pkg/tikz");
  });
});

describe("LaTeX completion from the package corpus", () => {
  const PREAMBLE = ["\\documentclass{article}", "\\usepackage{tikz}", ""].join("\n");

  function completeLatex(tail: string, cursorAt?: string): CompletionResult | null {
    const doc = `${PREAMBLE}${tail}`;
    install({ "main.tex": doc }, "main.tex");
    const pos = cursorAt === undefined ? doc.length : PREAMBLE.length + tail.indexOf(cursorAt);
    return complete(doc, pos);
  }

  it("offers corpus package names with a CTAN link", () => {
    corpus.packageNames = { names: ["tikz", "tikz-cd", "amsmath"], details: { tikz: "Graphics" } };
    const result = completeLatex("\\usepackage{ti");
    expect(labels(result)).toEqual(["tikz", "tikz-cd"]);
    expect(option(result, "tikz").detail).toBe("Graphics");
    expect(option(result, "tikz-cd").detail).toBe(completion.latexPackage);
    const dom = infoDom(option(result, "tikz"));
    expect(dom.querySelector("p")?.textContent).toBe("Graphics");
    expect(dom.querySelector("a")?.textContent).toBe("ctan.org/pkg/tikz");
    expect(infoDom(option(result, "tikz-cd")).querySelector("p")).toBeNull();
  });

  it("offers corpus document classes", () => {
    corpus.classNames = { names: ["article", "amsart"], details: {} };
    const result = completeLatex("\\documentclass{a");
    expect(labels(result)).toEqual(["article", "amsart"]);
    expect(option(result, "amsart").detail).toBe(completion.latexDocumentClass);
    expect(infoDom(option(result, "amsart")).querySelector("a")?.getAttribute("href")).toBe(
      "https://ctan.org/pkg/amsart",
    );
  });

  it("offers package and class options from their catalogs", () => {
    corpus.catalogs.set("tikz", {
      deps: [],
      macros: [],
      envs: [],
      keys: { "\\usepackage/tikz#c": ["dvisvgm"] },
      args: [],
      options: ["draft", "final"],
    });
    corpus.catalogs.set("class-article", {
      deps: [],
      macros: [],
      envs: [],
      keys: { "\\documentclass/article#c": ["a4paper", "twocolumn"] },
      args: [],
    });
    const packageOptions = completeLatex("\\usepackage[dr]{tikz}", "]");
    expect(labels(packageOptions)).toEqual(["draft"]);
    expect(option(packageOptions, "draft").detail).toBe(completion.packageOption.replace("{{name}}", "tikz"));
    expect(corpus.requestPackageCatalogs).toHaveBeenCalledWith(["tikz"]);

    expect(labels(completeLatex("\\documentclass[a4]{article}", "]"))).toEqual(["a4paper"]);
    expect(corpus.requestPackageCatalogs).toHaveBeenCalledWith(["class-article"]);
  });

  it("offers key=value keys of a package command", () => {
    corpus.catalogs.set("tikz", {
      deps: [],
      macros: [],
      envs: [],
      keys: { "\\tikzset": ["draw", "fill", "dashed"] },
      args: [],
    });
    const result = completeLatex("\\tikzset{d");
    expect(labels(result)).toEqual(["dashed", "draw"]);
    expect(option(result, "draw").detail).toBe(completion.keyvalKey.replace("{{command}}", "tikzset"));
    expect(labels(completeLatex("\\unknowncmd{d"))).toEqual([]);
  });

  it("offers package commands with their documentation and source", () => {
    corpus.catalogs.set("tikz", {
      deps: [],
      macros: [
        { name: "tikzset", snippet: ["tikzset{", "$", "{1}}"].join(""), detail: "\\tikzset{options}", documentation: "Set styles." },
        { name: "tikzhidden", unusual: true },
        { name: "tikzstyle" },
      ],
      envs: [],
      keys: {},
      args: [],
    });
    corpus.catalogs.set("class-article", {
      deps: [],
      macros: [{ name: "tikzset" }, { name: "tikzarticle" }],
      envs: [],
      keys: {},
      args: [],
    });
    const result = completeLatex("\\tikz");
    const editor = view(`${PREAMBLE}\\tikz`);
    const applied = complete(editor.state);
    expect(labels(result)).toEqual(["tikzset", "tikzstyle", "tikzarticle"]);
    expect(option(result, "tikzstyle").detail).toBe(completion.packageCommand);
    const styleInfo = infoDom(option(result, "tikzstyle"));
    expect([...styleInfo.querySelectorAll("p")].map((node) => node.textContent)).toEqual(["from tikz"]);
    const articleInfo = infoDom(option(result, "tikzarticle"));
    expect(articleInfo.querySelector("a")?.textContent).toBe("ctan.org/pkg/article");

    applyOption(editor, applied as CompletionResult, option(applied, "tikzset"));
    expect(editor.state.doc.toString()).toBe(`${PREAMBLE}\\tikzset{}`);
  });

  it("offers core and package environments and boosts the one being closed", () => {
    corpus.core = { commands: [], environments: [{ name: "itemize" }, { name: "tikzpicture" }] };
    corpus.catalogs.set("tikz", {
      deps: [],
      macros: [],
      envs: [{ name: "tikzpicture" }, { name: "scope" }, { name: "pgfonlayer", unusual: true }],
      keys: {},
      args: [],
    });
    const opening = labels(completeLatex("\\begin{"));
    expect(opening).toEqual(expect.arrayContaining(["tikzpicture", "scope", "itemize"]));
    expect(opening).not.toContain("pgfonlayer");
    const closing = completeLatex("\\begin{scope}\nx\n\\end{");
    expect(option(closing, "scope").boost).toBe(50);
    expect(option(closing, "itemize").boost).toBeUndefined();
  });
});

describe("guarded insertion", () => {
  it("names the environment at every cursor when several are active", () => {
    const doc = "\\begin{ite}\n\\end{ite}";
    install({ "main.tex": doc }, "main.tex");
    const editor = view(
      doc,
      EditorSelection.create([EditorSelection.cursor(doc.indexOf("}")), EditorSelection.cursor(doc.lastIndexOf("}"))], 0),
    );
    const result = complete(editor.state, doc.indexOf("}"));
    applyOption(editor, result as CompletionResult, option(result, "itemize"), doc.indexOf("}"));
    expect(editor.state.doc.toString()).toBe("\\begin{itemize}\n\\end{itemize}");
  });
});

describe("Markdown and BibTeX completion", () => {
  it("offers anchors after a Markdown link hash", () => {
    const notes = "# Introduction {#intro}\n\nSee [above](#in";
    install({ "notes.md": notes }, "notes.md");
    const result = complete(notes);
    expect(labels(result)).toContain("intro");
    expect(result?.from).toBe(notes.length - 2);
  });

  it("offers citation keys inside a BibTeX cross-reference", () => {
    const bib = "@book{knuth, title={TAOCP}}\n@inbook{part, crossref = {kn";
    install({ "refs.bib": bib, "main.tex": "\\bibliography{refs}" }, "refs.bib");
    expect(labels(complete(bib))).toContain("knuth");
    const plain = "@book{knuth, title={TAOCP}}\n@inbook{part, title={kn";
    install({ "refs.bib": plain, "main.tex": "\\bibliography{refs}" }, "refs.bib");
    expect(complete(plain)).toBeNull();
  });

  it("numbers citation keys that more than one bibliography defines", () => {
    const main = "\\bibliography{a,b}\n\\cite{kn";
    install(
      { "main.tex": main, "a.bib": "@book{knuth, title={A}}", "b.bib": "@book{knuth, title={B}}" },
      "main.tex",
    );
    const details = (complete(main)?.options ?? []).map((candidate) => candidate.detail ?? "");
    expect(details).toHaveLength(2);
    expect(details[0]).toContain(en.completion.duplicateIndex.replace("{{index}}", "1").replace("{{total}}", "2"));
    expect(details[1]).toContain(en.completion.duplicateIndex.replace("{{index}}", "2").replace("{{total}}", "2"));
  });

  it("has nothing to offer without analysis for a Markdown file or an unsupported path", () => {
    useFilesStore.setState({ projectId: PROJECT, activePath: "notes.md", files: {} });
    expect(complete("[see](#in")).toBeNull();
    useFilesStore.setState({ activePath: "data.csv" });
    expect(complete("x")).toBeNull();
    useFilesStore.setState({ activePath: null });
    expect(complete("x")).toBeNull();
  });
});

describe("completion source wiring", () => {
  const languageService: CompletionSource = () => null;

  it("chooses sources by file type", () => {
    expect(projectCompletionSourcesForPath(null)).toEqual([]);
    expect(projectCompletionSourcesForPath("image.png")).toEqual([]);
    expect(projectCompletionSourcesForPath("main.tex")).toHaveLength(2);
    expect(projectCompletionSourcesForPath("notes.md")).toEqual([projectIntelligenceCompletion]);
    expect(editorCompletionSourcesForPath(null, languageService)).toEqual([languageService]);
    expect(editorCompletionSourcesForPath("main.tex", languageService)).toHaveLength(3);
    expect(editorCompletionSourcesForPath("main.typ", languageService)).toHaveLength(1);
  });

  it("shifts later secondary options that apply their label or a string", () => {
    const primary: CompletionResult = { from: 0, options: [{ label: "alpha" }] };
    const secondary: CompletionResult = {
      from: 2,
      options: [{ label: "beta" }, { label: "gamma", apply: "gamma()" }],
    };
    const merged = mergeCompletionResults(primary, secondary) as CompletionResult;
    expect(merged.from).toBe(0);
    expect(merged.options[0]).toBe(primary.options[0]);
    type Apply = (target: EditorView, completion: Completion, from: number, to: number) => void;
    const first = view("x yy");
    (merged.options[1].apply as Apply)(first, merged.options[1], 0, 4);
    expect(first.state.doc.toString()).toBe("x beta");
    const second = view("x yy");
    (merged.options[2].apply as Apply)(second, merged.options[2], 0, 4);
    expect(second.state.doc.toString()).toBe("x gamma()");
    expect(mergeCompletionResults(primary, { from: 2, options: [{ label: "#alpha>" }] })).toBe(primary);
  });

  it("shifts a later primary option that applies itself", () => {
    const apply = vi.fn();
    const primary: CompletionResult = { from: 3, options: [{ label: "alpha", apply }] };
    const merged = mergeCompletionResults(primary, { from: 1, options: [{ label: "beta" }] }) as CompletionResult;
    const shifted = merged.options[0];
    const editor = view("x yy");
    (shifted.apply as (target: EditorView, completion: Completion, from: number, to: number) => void)(editor, shifted, 1, 4);
    expect(apply).toHaveBeenCalledWith(editor, shifted, 3, 4);
  });
});

describe("current-file reference fallback", () => {
  const MAIN = "\\section{Intro}\\label{sec:intro}\n\\ref{sec:intro}\n";
  const OTHER = "\\label{dup}\n\\label{fig:one}\n";

  function runningState(overrides: Record<string, unknown> = {}) {
    const value = snapshot({ "main.tex": MAIN, "other.tex": OTHER });
    useFilesStore.setState({ projectId: PROJECT, activePath: "main.tex" });
    useIndexStore.setState({
      texts: { "main.tex": MAIN, "other.tex": OTHER },
      intelligenceState: {
        status: "running",
        identity: value.identity,
        data: value,
        stale: true,
        currentFileFallbackAllowed: true,
        ...overrides,
      } as never,
    });
    return value;
  }

  it("flags unresolved and ambiguous references in the edited text", () => {
    runningState();
    const text = "\\label{dup}\n\\ref{missing}\n\\ref{dup}\n\\ref{fig:one}\n\\cite{nobody}\n";
    const found = currentFileReferenceDiagnostics("main.tex", text);
    expect(found.map((item) => item.message)).toEqual([
      en.diagnostics.unresolved.replace("{{noun}}", "reference").replace("{{name}}", "missing"),
      en.diagnostics.ambiguous.replace("{{noun}}", "Reference").replace("{{name}}", "dup").replace("{{count}}", "2"),
      en.diagnostics.unresolved.replace("{{noun}}", "citation").replace("{{name}}", "nobody"),
    ]);
    expect(found.every((item) => item.severity === "warning")).toBe(true);
    expect(found[0].source).toBe("live references · current file");
  });

  it("names a Typst at-reference as a label or citation", () => {
    const value = snapshot({ "main.typ": "= Intro <intro>\n" }, "main.typ");
    useFilesStore.setState({ projectId: PROJECT, activePath: "main.typ" });
    useIndexStore.setState({
      texts: { "main.typ": "= Intro <intro>\n" },
      intelligenceState: {
        status: "running",
        identity: value.identity,
        data: value,
        stale: true,
        currentFileFallbackAllowed: true,
      } as never,
    });
    const [finding] = currentFileReferenceDiagnostics("main.typ", "= Intro <intro>\nSee @ghost.\n");
    expect(finding.message).toBe(
      en.diagnostics.unresolved.replace("{{noun}}", "typst label or citation").replace("{{name}}", "ghost"),
    );
  });

  it.each([
    ["an unsupported file", () => runningState(), "notes.txt", "\\ref{x}"],
    ["a very long text", () => runningState(), "main.tex", "x".repeat(100_001)],
    ["too much markup", () => runningState(), "main.tex", "\\".repeat(2_001)],
    ["a finished analysis", () => runningState({ status: "success" }), "main.tex", "\\ref{x}"],
    ["a fresh analysis", () => runningState({ stale: false }), "main.tex", "\\ref{x}"],
    ["a project-wide invalidation", () => runningState({ currentFileFallbackAllowed: false }), "main.tex", "\\ref{x}"],
    ["another project", () => runningState({ identity: { projectId: "other", projectRevision: 1, requestGeneration: 1 } }), "main.tex", "\\ref{x}"],
    ["a file the snapshot never saw", () => runningState(), "new.tex", "\\ref{x}"],
  ])("stays quiet for %s", (_name, arrange, path, text) => {
    arrange();
    expect(currentFileReferenceDiagnostics(path, text)).toEqual([]);
  });

  it("stays quiet without a project, a snapshot or indexed text", () => {
    runningState();
    useFilesStore.setState({ projectId: null });
    expect(currentFileReferenceDiagnostics("main.tex", "\\ref{x}")).toEqual([]);
    runningState();
    useIndexStore.setState({ texts: {} });
    expect(currentFileReferenceDiagnostics("main.tex", "\\ref{x}")).toEqual([]);
    runningState({ data: null });
    expect(currentFileReferenceDiagnostics("main.tex", "\\ref{x}")).toEqual([]);
  });
});

describe("project diagnostics in the editor", () => {
  function diagnostics(target: EditorView) {
    const found: { from: number; to: number; message: string; source?: string; actions: number; severity: string }[] = [];
    forEachDiagnostic(target.state, (item: Diagnostic, from, to) => {
      found.push({ from, to, message: item.message, source: item.source, actions: item.actions?.length ?? 0, severity: item.severity });
    });
    return found;
  }

  function editorWith(doc: string): EditorView {
    const parent = document.createElement("div");
    document.body.append(parent);
    const editor = new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: projectIntelligenceExtensions() }),
    });
    views.push(editor);
    return editor;
  }

  async function settle(target: EditorView) {
    forceLinting(target);
    for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("labels partial results, clamps ranges and offers the related locations", async () => {
    const MAIN = "\\label{a}\n\\label{a}\n";
    const value = install({ "main.tex": MAIN }, "main.tex");
    const finding = value.diagnostics.find((item) => item.location.file === "main.tex");
    if (!finding) throw new Error("expected a duplicate-label finding");
    const partial = {
      ...value,
      status: "partial",
      diagnostics: [
        {
          ...finding,
          severity: "information",
          location: { ...finding.location, range: { ...finding.location.range, from: -5, to: 9_999 } },
          related: [
            { message: finding.message, location: { file: "main.tex", range: finding.location.range } },
          ],
        },
      ],
    } as unknown as ProjectIntelligenceSnapshot;
    useIndexStore.setState({
      intelligenceState: { status: "partial", identity: partial.identity, data: partial, stale: false },
    });
    const editor = editorWith(MAIN);
    await settle(editor);
    const [shown] = diagnostics(editor);
    expect(shown).toMatchObject({ from: 0, to: MAIN.length, severity: "info", source: "project intelligence · partial", actions: 1 });
    let action: (() => void) | undefined;
    forEachDiagnostic(editor.state, (item) => {
      action = () => item.actions?.[0].apply(editor, 0, 0);
    });
    action?.();
    expect(navigation.navigateToProjectRange).toHaveBeenCalledWith({
      path: "main.tex",
      range: finding.location.range,
      source: "diagnostic",
    });
  });

  it("falls back to the current-file check without an accepted snapshot", async () => {
    useFilesStore.setState({ projectId: PROJECT, activePath: null });
    let editor = editorWith("\\ref{x}");
    await settle(editor);
    expect(diagnostics(editor)).toEqual([]);

    useFilesStore.setState({ activePath: "main.tex" });
    editor = editorWith("\\ref{x}");
    await settle(editor);
    expect(diagnostics(editor)).toEqual([]);
  });

  it("refreshes once analysis updates settle and stops when destroyed", async () => {
    vi.useFakeTimers();
    const MAIN = "\\ref{a}\n";
    install({ "main.tex": MAIN }, "main.tex");
    const editor = editorWith(MAIN);
    await vi.advanceTimersByTimeAsync(10);
    expect(diagnostics(editor)).toHaveLength(1);

    const resolved = snapshot({ "main.tex": MAIN, "other.tex": "\\label{a}\n" });
    useIndexStore.setState({
      texts: { "main.tex": MAIN, "other.tex": "\\label{a}\n" },
      intelligenceState: { status: "success", identity: resolved.identity, data: resolved, stale: false },
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(diagnostics(editor)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(diagnostics(editor)).toEqual([]);

    editor.dispatch({ changes: { from: 0, insert: "%" } });
    editor.destroy();
    useIndexStore.setState({ intelligenceState: { status: "idle", identity: null, data: null, stale: false } as never });
    await vi.advanceTimersByTimeAsync(400);
    expect(diagnostics(editor)).toEqual([]);
  });

  it("skips the refresh for an editor that left the page", async () => {
    vi.useFakeTimers();
    install({ "main.tex": "\\ref{a}\n" }, "main.tex");
    const editor = editorWith("\\ref{a}\n");
    await vi.advanceTimersByTimeAsync(10);
    const dispatch = vi.spyOn(editor, "dispatch");
    editor.dom.remove();
    useIndexStore.setState({ intelligenceState: { status: "idle", identity: null, data: null, stale: false } as never });
    await vi.advanceTimersByTimeAsync(300);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
