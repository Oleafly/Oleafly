// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import type { EditorView as EditorViewType, Tooltip } from "@codemirror/view";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };
import type { LanguageServiceClient } from "@/lib/language-service";
import { activateInteractiveLanguageService } from "@/lib/analysis/interactive-language-service";
import {
  createProjectAnalysisSnapshot,
  type NormalizedDiagnostic,
  type ProjectDocumentDiagnostics,
} from "@/lib/analysis/project-snapshot";
import { useFilesStore } from "@/store/files";
import { useProjectAnalysisStore } from "@/store/project-analysis";

type HoverSource = (view: EditorViewType, pos: number, side: -1 | 1) => Promise<Tooltip | null>;

const captured = vi.hoisted(() => ({ hover: null as HoverSource | null }));

vi.mock("@codemirror/view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/view")>();
  return {
    ...actual,
    hoverTooltip: (source: HoverSource, options?: Parameters<typeof actual.hoverTooltip>[1]) => {
      captured.hover = source;
      return actual.hoverTooltip(source, options);
    },
  };
});

import { EditorView } from "@codemirror/view";
import {
  languageServiceDiagnostics,
  languageServiceEditorExtensions,
  languageServiceHover,
  semanticClass,
} from "./language-service";

const PROJECT = "project-view";
const range = (line: number, from: number, to: number) => ({
  start: { line, character: from },
  end: { line, character: to },
});

const client = {
  generation: 1,
  workspaceRoot: "/project",
  supports: vi.fn((_feature: string) => true),
  capabilities: {
    completionTriggerCharacters: [],
    signatureHelp: { triggerCharacters: [] },
    semanticTokens: {
      legend: {
        tokenTypes: ["keyword", "comment", "mystery", "function"],
        tokenModifiers: ["strong"],
      } as { tokenTypes: string[]; tokenModifiers: string[] } | null,
    },
  },
  requestHover: vi.fn(),
  requestSemanticTokensFull: vi.fn(),
  requestSemanticTokensRange: vi.fn(),
  requestSignatureHelp: vi.fn(),
  requestInlayHints: vi.fn(),
  requestDocumentColors: vi.fn(),
  requestDocumentLinks: vi.fn(),
};

let deactivate: (() => void) | null = null;
let views: EditorView[] = [];

function activate(text: string, active = "main.tex", revision = 1) {
  useFilesStore.setState({
    projectId: PROJECT,
    activePath: active,
    files: { [active]: { content: text, dirty: false } },
  });
  deactivate?.();
  deactivate = activateInteractiveLanguageService({
    owner: {},
    projectId: PROJECT,
    projectRevision: revision,
    kind: active.endsWith(".typ") ? "tinymist" : "texlab",
    positionEncoding: "utf-16",
    client: client as unknown as LanguageServiceClient,
    documentForPath: (path) =>
      path === active ? { path, uri: `file:///project/${active}`, text, version: 1 } : null,
  });
}

function editor(text: string, extensions = languageServiceEditorExtensions()): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc: text, extensions }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

beforeEach(() => {
  for (const mock of [
    client.requestHover,
    client.requestSemanticTokensFull,
    client.requestSemanticTokensRange,
    client.requestSignatureHelp,
    client.requestInlayHints,
    client.requestDocumentColors,
    client.requestDocumentLinks,
  ]) {
    mock.mockReset();
    mock.mockResolvedValue(null);
  }
  client.supports.mockReset();
  client.supports.mockReturnValue(true);
  client.capabilities.semanticTokens.legend = {
    tokenTypes: ["keyword", "comment", "mystery", "function"],
    tokenModifiers: ["strong"],
  };
});

afterEach(() => {
  vi.useRealTimers();
  for (const view of views) view.destroy();
  views = [];
  deactivate?.();
  deactivate = null;
  useProjectAnalysisStore.getState().reset();
});

describe("language service hover", () => {
  function hoverSource(): HoverSource {
    languageServiceHover();
    if (!captured.hover) throw new Error("hover source was not registered");
    return captured.hover;
  }

  async function hoverDom(view: EditorView, pos: number): Promise<HTMLElement | null> {
    const tooltip = await hoverSource()(view, pos, 1);
    if (!tooltip) return null;
    return tooltip.create(view).dom as HTMLElement;
  }

  it("splits hover text into paragraphs", async () => {
    const text = "\\section{A}";
    activate(text);
    client.requestHover.mockResolvedValue({ contents: "First block\n\nSecond block" });
    const dom = await hoverDom(editor(text, []), 2);
    expect(dom?.className).toBe("cm-language-service-hover select-text");
    expect([...(dom?.querySelectorAll("p") ?? [])].map((node) => node.textContent)).toEqual([
      "First block",
      "Second block",
    ]);
    expect(dom?.querySelector("a")).toBeNull();
    expect(client.requestHover.mock.calls[0][0]).toEqual({
      textDocument: { uri: "file:///project/main.tex" },
      position: { line: 0, character: 2 },
    });
  });

  it("joins marked strings and reads markup content", async () => {
    const text = "\\section{A}";
    activate(text);
    client.requestHover.mockResolvedValueOnce({
      contents: ["plain", { language: "latex", value: "\\x" }, { language: "typst" }, 3, { value: "" }],
    });
    let dom = await hoverDom(editor(text, []), 2);
    expect([...(dom?.querySelectorAll("p") ?? [])].map((node) => node.textContent)).toEqual([
      "plain",
      "\\x",
      "typst",
    ]);

    client.requestHover.mockResolvedValueOnce({ contents: { kind: "markdown", value: "Markdown" } });
    dom = await hoverDom(editor(text, []), 2);
    expect(dom?.textContent).toBe("Markdown");
  });

  it("links a package hover to its CTAN page", async () => {
    const text = "\\usepackage{amsmath}\n";
    activate(text);
    client.requestHover.mockResolvedValue({ contents: "AMS mathematics" });
    const dom = await hoverDom(editor(text, []), text.indexOf("math"));
    const link = dom?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://ctan.org/pkg/amsmath");
    expect(link?.textContent).toBe("ctan.org/pkg/amsmath");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("adds no CTAN link where there is no package name", async () => {
    const text = "\\usepackage{}";
    activate(text);
    client.requestHover.mockResolvedValue({ contents: "Load a package" });
    const dom = await hoverDom(editor(text, []), text.indexOf("}"));
    expect(dom?.textContent).toBe("Load a package");
    expect(dom?.querySelector("a")).toBeNull();
  });

  it("offers the Typst Universe page even without hover text", async () => {
    const text = "#import \"@preview/cetz:0.3.1\": canvas\n";
    activate(text, "main.typ");
    client.requestHover.mockResolvedValue({ contents: null });
    const dom = await hoverDom(editor(text, []), text.indexOf("cetz"));
    expect(dom?.querySelectorAll("p")).toHaveLength(0);
    const link = dom?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://typst.app/universe/package/cetz");
    expect(link?.textContent).toBe(en.languageService.openOnTypstUniverse);
  });

  it("shows nothing for an empty answer", async () => {
    const text = "\\section{A}";
    activate(text);
    client.requestHover.mockResolvedValueOnce(null);
    await expect(hoverDom(editor(text, []), 2)).resolves.toBeNull();
    client.requestHover.mockResolvedValueOnce({ contents: 42 });
    await expect(hoverDom(editor(text, []), 2)).resolves.toBeNull();
  });

  it("does not ask for files, clients or requests that cannot answer", async () => {
    activate("Notes", "notes.md");
    await expect(hoverDom(editor("Notes", []), 1)).resolves.toBeNull();

    activate("\\section{A}");
    client.supports.mockReturnValue(false);
    await expect(hoverDom(editor("\\section{A}", []), 1)).resolves.toBeNull();
    expect(client.requestHover).not.toHaveBeenCalled();

    client.supports.mockReturnValue(true);
    client.requestHover.mockRejectedValueOnce(new Error("timeout"));
    await expect(hoverDom(editor("\\section{A}", []), 1)).resolves.toBeNull();
  });

  it("drops an answer that arrives after the document changed", async () => {
    const text = "\\section{A}";
    activate(text);
    const view = editor(text, []);
    client.requestHover.mockImplementation(async () => {
      view.dispatch({ changes: { from: 0, insert: "x" } });
      return { contents: "late" };
    });
    await expect(hoverDom(view, 2)).resolves.toBeNull();
  });
});

describe("language service diagnostics", () => {
  const URI = "file:///project/main.tex";
  const TEXT = "\\section{A}\nbody\n";

  function diagnostic(overrides: Partial<NormalizedDiagnostic>): NormalizedDiagnostic {
    return {
      id: overrides.message ?? "d",
      uri: URI,
      range: range(0, 0, 8),
      severity: "error",
      message: "problem",
      source: "texlab",
      projectRevision: 1,
      ...overrides,
    };
  }

  function install(
    data: NormalizedDiagnostic[],
    entry: Partial<ProjectDocumentDiagnostics> = {},
    identity: { projectId?: string; projectRevision?: number; languageServiceGeneration?: number } = {},
    updatedAt = 10,
  ) {
    const snapshot = createProjectAnalysisSnapshot({
      projectId: identity.projectId ?? PROJECT,
      projectRevision: identity.projectRevision ?? 1,
      languageServiceGeneration: identity.languageServiceGeneration ?? 1,
    });
    useProjectAnalysisStore.setState({
      snapshot: {
        ...snapshot,
        diagnosticsByUri: {
          [URI]: {
            uri: URI,
            diagnosticEpoch: 1,
            status: "acknowledged",
            data,
            request: {
              projectId: PROJECT,
              projectRevision: 1,
              languageServiceGeneration: 1,
              requestGeneration: 1,
              documentUri: URI,
              documentVersion: 1,
            },
            ...entry,
          },
        },
        updatedAt,
      },
    });
  }

  function found(view: EditorView) {
    const out: { from: number; to: number; severity: string; message: string; source?: string }[] = [];
    forEachDiagnostic(view.state, (item, from, to) => {
      out.push({ from, to, severity: item.severity, message: item.message, source: item.source });
    });
    return out;
  }

  async function settle(view: EditorView) {
    forceLinting(view);
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  it("shows acknowledged diagnostics for the current document version", async () => {
    activate(TEXT);
    install([
      diagnostic({ message: "bad section" }),
      diagnostic({ message: "note", severity: "information", source: "", range: range(1, 0, 4), documentVersion: 1 }),
      diagnostic({ message: "old revision", projectRevision: 2 }),
      diagnostic({ message: "old version", documentVersion: 2 }),
      diagnostic({ message: "outside", range: range(9, 0, 1) }),
      diagnostic({ message: "reversed", range: range(0, 4, 1) }),
    ]);
    const view = editor(TEXT, languageServiceDiagnostics());
    await settle(view);
    expect(found(view)).toEqual([
      { from: 0, to: 8, severity: "error", message: "bad section", source: "texlab" },
      { from: 12, to: 16, severity: "info", message: "note", source: "language service" },
    ]);
  });

  it.each([
    ["a pending entry", { status: "pending" as const }, {}],
    ["another project", {}, { projectId: "other" }],
    ["another revision", {}, { projectRevision: 2 }],
    ["another service generation", {}, { languageServiceGeneration: 2 }],
    [
      "a request for another revision",
      { request: { projectId: PROJECT, projectRevision: 3, languageServiceGeneration: 1, requestGeneration: 1, documentVersion: 1 } },
      {},
    ],
    [
      "a request for another version",
      { request: { projectId: PROJECT, projectRevision: 1, languageServiceGeneration: 1, requestGeneration: 1, documentVersion: 4 } },
      {},
    ],
  ])("ignores diagnostics from %s", async (_name, entry, identity) => {
    activate(TEXT);
    install([diagnostic({})], entry, identity);
    const view = editor(TEXT, languageServiceDiagnostics());
    await settle(view);
    expect(found(view)).toEqual([]);
  });

  it("shows nothing for other files or a document the service does not track", async () => {
    activate("notes", "notes.md");
    install([diagnostic({})]);
    let view = editor("notes", languageServiceDiagnostics());
    await settle(view);
    expect(found(view)).toEqual([]);

    activate(TEXT);
    view = editor("different text", languageServiceDiagnostics());
    await settle(view);
    expect(found(view)).toEqual([]);
  });

  it("refreshes once after a burst of analysis updates settles", async () => {
    vi.useFakeTimers();
    activate(TEXT);
    const view = editor(TEXT, languageServiceDiagnostics());
    await vi.advanceTimersByTimeAsync(10);
    expect(found(view)).toEqual([]);

    install([diagnostic({ message: "first" })], {}, {}, 20);
    await vi.advanceTimersByTimeAsync(200);
    install([diagnostic({ message: "second" })], {}, {}, 30);
    await vi.advanceTimersByTimeAsync(299);
    expect(found(view)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(found(view).map((item) => item.message)).toEqual(["second"]);
  });

  it("refreshes when the language service session changes and stops after destroy", async () => {
    vi.useFakeTimers();
    activate(TEXT);
    install([diagnostic({ message: "kept" })]);
    const view = editor(TEXT, languageServiceDiagnostics());
    await vi.advanceTimersByTimeAsync(10);
    expect(found(view)).toHaveLength(1);

    activate(TEXT, "main.tex", 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(found(view)).toEqual([]);

    view.destroy();
    install([diagnostic({ message: "after" })], {}, {}, 99);
    await vi.advanceTimersByTimeAsync(300);
    expect(found(view)).toEqual([]);
  });

  it("skips the refresh for an editor that left the page", async () => {
    vi.useFakeTimers();
    activate(TEXT);
    const view = editor(TEXT, languageServiceDiagnostics());
    await vi.advanceTimersByTimeAsync(10);
    view.dom.remove();
    install([diagnostic({ message: "hidden" })], {}, {}, 50);
    await vi.advanceTimersByTimeAsync(300);
    expect(found(view)).toEqual([]);
  });
});

describe("semantic tokens", () => {
  const TEXT = "\\section{A}\n% note\n";

  function marked(view: EditorView, className: string): string[] {
    return [...view.contentDOM.querySelectorAll(`.${className}`)].map((node) => node.textContent ?? "");
  }

  function supportOnly(features: string[]) {
    client.supports.mockImplementation((feature: string) => features.includes(feature));
  }

  it("decorates the document from a full token answer", async () => {
    activate(TEXT);
    supportOnly(["semanticTokensFull"]);
    client.requestSemanticTokensFull.mockResolvedValue({
      data: [0, 0, 8, 0, 1, 0, 8, 1, 2, 0, 1, 0, 6, 1, 0, 0, 0, 0, 3, 0],
    });
    const view = editor(TEXT);
    await vi.waitFor(() => expect(marked(view, "cm-semantic-keyword")).toEqual(["\\section"]));
    expect(marked(view, "cm-semantic-strong")).toEqual(["\\section"]);
    expect(marked(view, "cm-semantic-comment")).toEqual(["% note"]);
    expect(marked(view, "cm-semantic-function")).toEqual([]);
    expect(client.requestSemanticTokensFull.mock.calls[0][0]).toEqual({
      textDocument: { uri: "file:///project/main.tex" },
    });
    expect(client.requestSemanticTokensRange).not.toHaveBeenCalled();
  });

  it("asks for the visible range when the service supports it", async () => {
    activate(TEXT);
    supportOnly(["semanticTokensFull", "semanticTokensRange"]);
    client.requestSemanticTokensRange.mockResolvedValue({ data: [1, 0, 6, 1, 0] });
    const view = editor(TEXT);
    await vi.waitFor(() => expect(marked(view, "cm-semantic-comment")).toEqual(["% note"]));
    expect(client.requestSemanticTokensRange.mock.calls[0][0]).toMatchObject({
      textDocument: { uri: "file:///project/main.tex" },
      range: { start: { line: 0, character: 0 } },
    });
  });

  it.each([
    ["a malformed token array", { data: [0, 0, 1] }],
    ["negative token numbers", { data: [0, 0, -1, 0, 0] }],
    ["a missing data array", { result: [] }],
    ["more tokens than the text can hold", { data: Array.from({ length: 5 * 40 }, () => 0) }],
    ["a token outside the document", { data: [9, 0, 2, 0, 0] }],
  ])("ignores %s", async (_name, response) => {
    activate(TEXT);
    supportOnly(["semanticTokensFull"]);
    client.requestSemanticTokensFull.mockResolvedValue(response);
    const view = editor(TEXT);
    await vi.waitFor(() => expect(client.requestSemanticTokensFull).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.contentDOM.querySelector("[class*='cm-semantic-']")).toBeNull();
  });

  it("ignores tokens when the server sent no legend", async () => {
    activate(TEXT);
    supportOnly(["semanticTokensFull"]);
    client.capabilities.semanticTokens.legend = null;
    client.requestSemanticTokensFull.mockResolvedValue({ data: [0, 0, 8, 0, 0] });
    const view = editor(TEXT);
    await vi.waitFor(() => expect(client.requestSemanticTokensFull).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(marked(view, "cm-semantic-keyword")).toEqual([]);
  });

  it("does not ask outside language-service files or without support", async () => {
    activate("notes", "notes.md");
    editor("notes");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    activate(TEXT);
    supportOnly([]);
    editor(TEXT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.requestSemanticTokensFull).not.toHaveBeenCalled();
    expect(client.requestSemanticTokensRange).not.toHaveBeenCalled();
  });

  it("clears the tokens when a later request fails", async () => {
    activate(TEXT);
    supportOnly(["semanticTokensFull"]);
    client.requestSemanticTokensFull.mockResolvedValueOnce({ data: [0, 0, 8, 0, 0] });
    const view = editor(TEXT);
    await vi.waitFor(() => expect(marked(view, "cm-semantic-keyword")).toEqual(["\\section"]));
    client.requestSemanticTokensFull.mockRejectedValueOnce(new Error("crashed"));
    activate(TEXT);
    await vi.waitFor(() => expect(marked(view, "cm-semantic-keyword")).toEqual([]));
    expect(client.requestSemanticTokensFull).toHaveBeenCalledTimes(2);
  });

  it("drops an answer for text that has since changed and clears on edit", async () => {
    activate(TEXT);
    supportOnly(["semanticTokensFull"]);
    let resolve: (value: unknown) => void = () => {};
    client.requestSemanticTokensFull.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = editor(TEXT);
    await vi.waitFor(() => expect(client.requestSemanticTokensFull).toHaveBeenCalled());
    view.dispatch({ changes: { from: 0, insert: "x" } });
    resolve({ data: [0, 0, 8, 0, 0] });
    await new Promise((done) => setTimeout(done, 0));
    expect(marked(view, "cm-semantic-keyword")).toEqual([]);
  });

  it("stops listening once the editor is destroyed", async () => {
    activate(TEXT);
    supportOnly(["semanticTokensFull"]);
    const view = editor(TEXT);
    await vi.waitFor(() => expect(client.requestSemanticTokensFull).toHaveBeenCalledTimes(1));
    view.destroy();
    activate(TEXT);
    await new Promise((done) => setTimeout(done, 0));
    expect(client.requestSemanticTokensFull).toHaveBeenCalledTimes(1);
  });
});

describe("semanticClass", () => {
  it("maps standard LSP token types onto editor classes", () => {
    expect(
      [
        "keyword",
        "modifier",
        "comment",
        "string",
        "number",
        "method",
        "macro",
        "type",
        "class",
        "struct",
        "enum",
        "interface",
        "typeParameter",
        "property",
        "enumMember",
        "variable",
        "parameter",
        "operator",
        "namespace",
        "decorator",
        "regexp",
        "term",
        "punct",
        "bool",
        "label",
        "nothing",
      ].map(semanticClass),
    ).toEqual([
      "cm-semantic-keyword",
      "cm-semantic-keyword",
      "cm-semantic-comment",
      "cm-semantic-string",
      "cm-semantic-number",
      "cm-semantic-function",
      "cm-semantic-function",
      "cm-semantic-type",
      "cm-semantic-type",
      "cm-semantic-type",
      "cm-semantic-type",
      "cm-semantic-type",
      "cm-semantic-type",
      "cm-semantic-property",
      "cm-semantic-property",
      "cm-semantic-variable",
      "cm-semantic-variable",
      "cm-semantic-operator",
      "cm-semantic-namespace",
      "cm-semantic-decorator",
      "cm-semantic-regexp",
      "cm-semantic-term",
      "cm-semantic-bracket",
      "cm-semantic-number",
      "cm-semantic-label",
      null,
    ]);
  });
});
