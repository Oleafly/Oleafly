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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroHit, ZoteroLibraryStatus } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({ search: vi.fn(), ensure: vi.fn() }));

vi.mock("@/lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tauri")>()),
  zoteroLibrarySearch: mocks.search,
}));

vi.mock("@/features/zotero-cite", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/zotero-cite")>()),
  ensureZoteroEntries: mocks.ensure,
}));

import { analyzeProjectFile } from "@/lib/project-intelligence/analyze-file";
import { assembleProjectIntelligence } from "@/lib/project-intelligence/assemble";
import { resetZoteroSearchCache } from "@/lib/zotero/search-client";
import { useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { resetZoteroLibraryForTest, useZoteroLibraryStore } from "@/store/zotero-library";
import { zoteroCitationSource } from "./zotero-completion";

if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
}

const BIB = "@article{smithProject2019,\n  author = {Smith, John},\n  title = {Smithing metals},\n  year = {2019},\n  doi = {10.1/proj}\n}\n";

function hit(citationKey: string, overrides: Partial<ZoteroHit> = {}): ZoteroHit {
  return {
    library: "user",
    itemKey: citationKey.slice(0, 8).toUpperCase(),
    citationKey,
    keySource: "bbt",
    title: "Deep learning",
    authors: ["Smith"],
    authorCount: 1,
    year: "2020",
    itemType: "journalArticle",
    dateModified: "2024-01-01T00:00:00Z",
    score: 1,
    ...overrides,
  };
}

const ZOTERO_HITS = [
  hit("smithBBT2020", { doi: "10.1/smith" }),
  hit("smithProject2019", { title: "Smithing metals", year: "2019" }),
  hit("otherKeySamePaper", { authors: ["Smith"], doi: "https://doi.org/10.1/PROJ" }),
  hit("smileyGroup2018", { authors: ["Smiley"], library: "group:7", year: "2018" }),
];

function status(overrides: Partial<ZoteroLibraryStatus> = {}): ZoteroLibraryStatus {
  return {
    local: { state: "ready", zoteroVersion: "7.0.11", bbtVersion: "6.7.240" },
    web: "notConnected",
    libraries: [
      { id: "user", name: "", kind: "user", itemCount: 3, enabled: true },
      { id: "group:7", name: "Lab Group", kind: "group", itemCount: 1, enabled: true },
    ],
    itemCount: 4,
    syncing: false,
    generation: 1,
    bbtSeen: true,
    loaded: true,
    ...overrides,
  };
}

function install(path: string, text: string) {
  const sources: Record<string, string> = { [path]: text, "refs.bib": BIB };
  const files = Object.fromEntries(
    Object.entries(sources).map(([file, source]) => [file, analyzeProjectFile(file, source, 1)]),
  );
  const snapshot = assembleProjectIntelligence({
    identity: { projectId: "zotero-project", projectRevision: 1, requestGeneration: 1 },
    files,
    knownFiles: Object.keys(sources),
    mainDocument: path,
    stats: { fileCount: 2, characterCount: 0, parsedFileCount: 2, reusedFileCount: 0, durationMs: 0 },
  });
  useFilesStore.setState({
    projectId: "zotero-project",
    activePath: path,
    files: Object.fromEntries(Object.entries(sources).map(([file, content]) => [file, { content, dirty: false }])),
    tree: Object.keys(sources).map((file) => ({ path: file, name: file, is_dir: false })) as never,
  });
  useIndexStore.setState({
    texts: { ...sources },
    intelligenceState: { status: "success", identity: snapshot.identity, data: snapshot, stale: false },
  });
  setEditorDocumentPath(path);
}

function view(text: string): EditorView {
  return new EditorView({ state: EditorState.create({ doc: text }), parent: document.body });
}

async function complete(source: CompletionSource, editor: EditorView, explicit = false) {
  const context = new CompletionContext(editor.state, editor.state.doc.length, explicit, editor);
  return { context, value: source(context) };
}

function labels(result: CompletionResult | null): string[] {
  return (result?.options ?? []).map((option) => String(option.displayLabel ?? option.label));
}

function apply(editor: EditorView, result: CompletionResult, option: Completion) {
  if (typeof option.apply !== "function") throw new Error("expected apply function");
  option.apply(editor, option, result.from, editor.state.doc.length);
}

function option(result: CompletionResult | null, label: string): Completion {
  const found = result?.options.find((candidate) => (candidate.displayLabel ?? candidate.label) === label);
  if (!found) throw new Error(`missing ${label}: ${labels(result).join(", ")}`);
  return found;
}

const base: CompletionSource = vi.fn(() => null);

beforeEach(() => {
  resetZoteroSearchCache();
  resetZoteroLibraryForTest();
  mocks.search.mockReset();
  mocks.ensure.mockReset();
  mocks.ensure.mockResolvedValue({ added: [], reused: [], bibPath: "refs.bib" });
  mocks.search.mockImplementation(async (query: string) => ({
    generation: 1,
    total: ZOTERO_HITS.length,
    hits: ZOTERO_HITS.filter((candidate) => candidate.citationKey.toLowerCase().startsWith(query) || candidate.authors.some((name) => name.toLowerCase().startsWith(query))),
  }));
  useZoteroLibraryStore.setState({ status: status() });
});

afterEach(() => {
  setEditorDocumentPath(null);
  document.body.replaceChildren();
  useFilesStore.setState({ projectId: null, activePath: null, files: {}, tree: [] });
  useIndexStore.getState().reset();
  useSettingsStore.setState({ settingsOpen: false });
});

describe("@ citations in LaTeX", () => {
  it("merges the project .bib with the Zotero library, without duplicate keys or DOIs", async () => {
    install("main.tex", "See @smi");
    const editor = view("See @smi");
    const source = zoteroCitationSource("latex", base);
    const { value } = await complete(source, editor);
    expect(value).toBeInstanceOf(Promise);
    const result = (await value) as CompletionResult;
    expect(result.from).toBe(4);
    expect(result.filter).toBe(false);
    const shown = labels(result);
    expect(shown.filter((label) => label === "smithProject2019")).toHaveLength(1);
    expect(shown).toContain("smithBBT2020");
    expect(shown).toContain("smileyGroup2018");
    expect(shown).not.toContain("otherKeySamePaper");
    expect(option(result, "smileyGroup2018").detail).toContain("Lab Group");
    apply(editor, result, option(result, "smithBBT2020"));
    expect(editor.state.doc.toString()).toBe("See \\cite{smithBBT2020}");
    expect(mocks.ensure).toHaveBeenCalledWith(
      [expect.objectContaining({ key: "smithBBT2020", hit: expect.objectContaining({ itemKey: "SMITHBBT" }) })],
      expect.anything(),
    );
  });

  it("answers repeated and narrowed queries from the cache without waiting on Zotero", async () => {
    install("main.tex", "See @smi");
    const source = zoteroCitationSource("latex", base);
    await (await complete(source, view("See @smi"))).value;
    const again = (await complete(source, view("See @smi"))).value;
    expect(again).not.toBeInstanceOf(Promise);
    expect(labels(again as CompletionResult)).toContain("smithBBT2020");
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });

  it("uses the document's own cite command and inserts project entries too", async () => {
    install("main.tex", "\\parencite{a} \\parencite{b}\nSee @smi");
    const editor = view("\\parencite{a} \\parencite{b}\nSee @smi");
    const result = (await (await complete(zoteroCitationSource("latex", base), editor)).value) as CompletionResult;
    apply(editor, result, option(result, "smithProject2019"));
    expect(editor.state.doc.toString()).toBe("\\parencite{a} \\parencite{b}\nSee \\parencite{smithProject2019}");
    expect(mocks.ensure).not.toHaveBeenCalled();
  });

  it("searches author and title words together and closes when nothing matches", async () => {
    install("main.tex", "See @smith metals");
    const source = zoteroCitationSource("latex", base);
    const result = (await (await complete(source, view("See @smith metals"))).value) as CompletionResult;
    expect(labels(result)).toEqual(["smithProject2019"]);
    const none = await (await complete(source, view("See @smith and then we wrote more"))).value;
    expect(none).toBeNull();
  });

  it("completes inside an existing cite command", async () => {
    install("main.tex", "\\citep[see][p.~4]{a, smi");
    const editor = view("\\citep[see][p.~4]{a, smi");
    const result = (await (await complete(zoteroCitationSource("latex", base), editor)).value) as CompletionResult;
    apply(editor, result, option(result, "smithBBT2020"));
    expect(editor.state.doc.toString()).toBe("\\citep[see][p.~4]{a, smithBBT2020");
  });

  it("shows Zotero titles without their rich-text markup", async () => {
    const rich = hit("wasserstein2016", {
      authors: ["Wasserstein"],
      title: 'The <span class="nocase">ASA</span> Statement on <i>p</i> -Values: Context, Process, and Purpose',
      year: "2016",
    });
    mocks.search.mockResolvedValue({ generation: 1, total: 1, hits: [rich] });
    install("main.tex", "See @wass");
    const result = (await (await complete(zoteroCitationSource("latex", base), view("See @wass"))).value) as CompletionResult;
    const found = option(result, "wasserstein2016");
    expect(found.detail).toContain("The ASA Statement on p -Values");
    expect(found.detail).not.toMatch(/[<>]/u);
    const info = (found.info as (completion: Completion) => Node)(found);
    expect(info.textContent).toContain("The ASA Statement on p -Values: Context, Process, and Purpose");
    expect(info.textContent).not.toMatch(/[<>]/u);
  });

  it("leaves math @ shortcuts and other contexts to the existing sources", async () => {
    install("main.tex", "$x = @a");
    const fallback = vi.fn<CompletionSource>(() => null);
    const source = zoteroCitationSource("latex", fallback);
    expect((await complete(source, view("$x = @a"))).value).toBeNull();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect((await complete(source, view("\\sec"))).value).toBeNull();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("cancels a pending search when the request is aborted", async () => {
    install("main.tex", "See @deep");
    const editor = view("See @deep");
    const { context, value } = await complete(zoteroCitationSource("latex", base), editor);
    const listeners = (context as unknown as { abortListeners: (() => void)[] }).abortListeners;
    for (const listener of listeners) listener();
    (context as unknown as { abortListeners: null }).abortListeners = null;
    await expect(value).resolves.toBeNull();
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

describe("@ citations in Typst and Markdown", () => {
  it("inserts @key in Typst", async () => {
    install("main.typ", "As @smi");
    const editor = view("As @smi");
    const result = (await (await complete(zoteroCitationSource("typst", base), editor)).value) as CompletionResult;
    apply(editor, result, option(result, "smithBBT2020"));
    expect(editor.state.doc.toString()).toBe("As @smithBBT2020");
  });

  it("inserts [@key] in Markdown prose and @key inside brackets", async () => {
    install("paper.md", "As @smi");
    const prose = view("As @smi");
    const source = zoteroCitationSource("markdown", base);
    const result = (await (await complete(source, prose)).value) as CompletionResult;
    apply(prose, result, option(result, "smithBBT2020"));
    expect(prose.state.doc.toString()).toBe("As [@smithBBT2020]");
    const bracketed = view("[see @smi");
    const inside = (await (await complete(source, bracketed)).value) as CompletionResult;
    apply(bracketed, inside, option(inside, "smithBBT2020"));
    expect(bracketed.state.doc.toString()).toBe("[see @smithBBT2020");
  });

  it("keeps labels from the project source next to citations", async () => {
    install("main.typ", "As @fig");
    const withLabels: CompletionSource = () => ({
      from: 4,
      options: [{ label: "fig-setup", type: "variable" }],
    });
    const result = (await (await complete(zoteroCitationSource("typst", withLabels), view("As @fig"))).value) as CompletionResult;
    expect(labels(result)).toContain("fig-setup");
    expect(result.from).toBe(3);
  });

  it("filters the language server's labels and entries by what was typed", async () => {
    const discovery = hit("discovery2021", { authors: ["Lee"], title: "Discovery science", year: "2021" });
    mocks.search.mockImplementation(async (query: string) => {
      const hits = "discovery".startsWith(query) || query.startsWith("disc") ? [discovery] : [];
      return { generation: 1, total: hits.length, hits };
    });
    const server: CompletionSource = (context) => ({
      from: context.pos - context.state.sliceDoc(0, context.pos).replace(/^[\s\S]*@/u, "").length,
      options: [
        { label: "sec:method", type: "variable" },
        { label: "eq:loss", type: "variable" },
        { label: "tab:results", type: "variable" },
        { label: "fig:results", type: "variable" },
        { label: "knuth1984", type: "variable", detail: "The TeXbook" },
        { label: "discovery-figure", type: "variable" },
      ],
      filter: false,
    });
    install("main.typ", "As @discovery");
    const typed = (await (await complete(zoteroCitationSource("typst", server), view("As @discovery"))).value) as CompletionResult;
    expect(labels(typed)).toEqual(["discovery2021", "discovery-figure"]);
    install("main.typ", "As @res");
    const partial = (await (await complete(zoteroCitationSource("typst", server), view("As @res"))).value) as CompletionResult;
    expect(labels(partial)).toEqual(["tab:results", "fig:results"]);
    install("main.typ", "As @");
    const blank = (await (await complete(zoteroCitationSource("typst", server), view("As @"))).value) as CompletionResult;
    expect(labels(blank)).toEqual(expect.arrayContaining(["sec:method", "eq:loss", "knuth1984", "discovery-figure"]));
  });

  it("filters merged Markdown labels by what was typed", async () => {
    const withLabels: CompletionSource = () => ({
      from: 4,
      options: [
        { label: "fig:smile", type: "variable" },
        { label: "tbl:other", type: "variable" },
      ],
    });
    install("paper.md", "As @smi");
    const result = (await (await complete(zoteroCitationSource("markdown", withLabels), view("As @smi"))).value) as CompletionResult;
    expect(labels(result)).toContain("fig:smile");
    expect(labels(result)).not.toContain("tbl:other");
  });
});

describe("Zotero hints", () => {
  it("shows the exact fix when the local API switch is off and opens Settings", async () => {
    install("main.tex", "See @smi");
    useZoteroLibraryStore.setState({ status: status({ local: { state: "apiDisabled", zoteroVersion: "7.0.11" }, itemCount: 0 }) });
    const editor = view("See @smi");
    const value = (await complete(zoteroCitationSource("latex", base), editor)).value;
    expect(value).not.toBeInstanceOf(Promise);
    const result = value as CompletionResult;
    const hint = result.options.at(-1);
    expect(String(hint?.label)).toContain("Allow other applications on this computer to communicate with Zotero");
    expect(labels(result)).toContain("smithProject2019");
    apply(editor, result, hint as Completion);
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
    expect(editor.state.doc.toString()).toBe("See @smi");
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("stays quiet for people who do not use Zotero", async () => {
    install("main.tex", "See @smi");
    useZoteroLibraryStore.setState({ status: status({ local: { state: "notRunning" }, itemCount: 0, bbtSeen: false }) });
    const result = (await complete(zoteroCitationSource("latex", base), view("See @smi"))).value as CompletionResult;
    expect(labels(result)).toEqual(["smithProject2019"]);
  });
});
