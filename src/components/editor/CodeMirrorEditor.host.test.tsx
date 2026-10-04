// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import type { EditorHost, VisualPorts } from "@oleafly/editor/CodeMirrorEditor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SpellHostShape {
  getProjectId: () => string | null;
  getActivePath: () => string | null;
  getProofreadingContextKey: (projectId: string | null) => string;
  getLintPrefs: () => { showRegionalism: boolean; showWordChoice: boolean; dialect: string };
  proofread: (input: Record<string, unknown>) => unknown;
  getRetainedProofreading: (input: Record<string, unknown>) => unknown;
  suggest: (word: string) => unknown;
}

interface CoreProps {
  host: EditorHost;
  extraExtensionsForPath: (path: string | null) => unknown[];
  extraKeymap: KeyBinding[];
}

const captured = vi.hoisted(() => ({
  spellHost: null as SpellHostShape | null,
  bibKeys: null as (() => string[]) | null,
  csl: null as (() => string[]) | null,
  typstVersion: null as (() => string | null) | null,
  wysiwygTranslator: null as ((key: string, params?: Record<string, string | number>) => string) | null,
  props: null as CoreProps | null,
}));

const mocks = vi.hoisted(() => ({
  closeEnvironmentOnEnter: vi.fn((_view: unknown) => true),
  proofreadDocument: vi.fn((_input: unknown) => "proofread"),
  getRetainedProofreadingResult: vi.fn((_input: unknown) => "retained"),
  suggestSpelling: vi.fn((_word: string, _locale: string) => "suggestions"),
  cancelProofreading: vi.fn(),
  resolveVisualAsset: vi.fn(),
  openVisualFigureEditor: vi.fn(async () => {}),
  referenceKindIn: vi.fn((_index: unknown, _key: string) => "figure"),
}));

vi.mock("@oleafly/latex-intelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/latex-intelligence")>()),
  loadCore: async () => null,
  loadAtSuggestions: async () => null,
  loadPackageNames: async () => null,
  loadClassNames: async () => null,
}));
vi.mock("@oleafly/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/editor")>();
  return {
    ...actual,
    setSpellHost: (host: SpellHostShape) => {
      captured.spellHost = host;
    },
    setBibKeysProvider: (provider: () => string[]) => {
      captured.bibKeys = provider;
    },
    setTypstCslStyleProvider: (provider: () => string[]) => {
      captured.csl = provider;
    },
    setTypstStyleVersionProvider: (provider: () => string | null) => {
      captured.typstVersion = provider;
    },
    closeEnvironmentOnEnter: mocks.closeEnvironmentOnEnter,
  };
});
vi.mock("@oleafly/wysiwyg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@oleafly/wysiwyg")>();
  return {
    ...actual,
    setWysiwygTranslator: (translator: (key: string) => string) => {
      captured.wysiwygTranslator = translator;
    },
  };
});
vi.mock("@oleafly/editor/CodeMirrorEditor", () => ({
  CodeMirrorEditor: (props: CoreProps) => {
    captured.props = props;
    return null;
  },
}));
vi.mock("@/lib/proofreading/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/proofreading/client")>()),
  proofreadDocument: mocks.proofreadDocument,
  getRetainedProofreadingResult: mocks.getRetainedProofreadingResult,
  suggestSpelling: mocks.suggestSpelling,
  cancelProofreading: mocks.cancelProofreading,
}));
vi.mock("./wysiwyg/asset-url", () => ({ resolveVisualAsset: mocks.resolveVisualAsset }));
vi.mock("./visual-figure-edit", () => ({ openVisualFigureEditor: mocks.openVisualFigureEditor }));
vi.mock("./visual-reference-kind", () => ({ referenceKindIn: mocks.referenceKindIn }));

import { useDictionary } from "@/lib/dictionary";
import { currentDictionaryLocale } from "@/lib/proofreading/effective-locale";
import { useFilesStore } from "@/store/files";
import { useInlineEditStore } from "@/store/inlineEdit";
import { useIndexStore } from "@/store/project-index";
import { useSettingsStore } from "@/store/settings";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

function spellHost(): SpellHostShape {
  if (!captured.spellHost) throw new Error("spell host was not installed");
  return captured.spellHost;
}

function mountProps(): CoreProps {
  render(<CodeMirrorEditor />);
  if (!captured.props) throw new Error("the core editor did not render");
  return captured.props;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`missing ${name}`);
  return value;
}

function binding(keymap: KeyBinding[], key: string): NonNullable<KeyBinding["run"]> {
  const found = keymap.find((entry) => entry.key === key)?.run;
  if (!found) throw new Error(`no binding for ${key}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  useFilesStore.setState({ projectId: "p1", activePath: "main.tex", files: {}, tree: [] });
  useDictionary.setState({ global: [], ignored: {} });
});

afterEach(() => {
  cleanup();
  useInlineEditStore.getState().reset();
});

describe("the proofreading host", () => {
  it("reads the active project and file and the lint preferences", () => {
    useSettingsStore.setState({ showRegionalism: true, showWordChoice: false, grammarDialect: "british" });
    expect(spellHost().getProjectId()).toBe("p1");
    expect(spellHost().getActivePath()).toBe("main.tex");
    expect(spellHost().getLintPrefs()).toEqual({
      showRegionalism: true,
      showWordChoice: false,
      dialect: "british",
    });
  });

  it("keys the proofreading context on sorted rules and dictionary words", () => {
    useSettingsStore.setState({
      harperDisabledRules: ["b", "a"],
      harperEnabledRules: ["z", "y"],
    });
    useDictionary.setState({ global: ["zeta", "alpha"], ignored: { p1: ["teh", "abc"] } });
    const key = JSON.parse(spellHost().getProofreadingContextKey("p1")) as unknown[];
    expect(key.slice(6)).toEqual([
      ["a", "b"],
      ["y", "z"],
      useDictionary.getState().revision,
      ["alpha", "zeta"],
      ["abc", "teh"],
    ]);
    const anonymous = JSON.parse(spellHost().getProofreadingContextKey(null)) as unknown[];
    expect(anonymous.at(-1)).toEqual([]);
    const unknownProject = JSON.parse(spellHost().getProofreadingContextKey("p2")) as unknown[];
    expect(unknownProject.at(-1)).toEqual([]);
  });

  it("sends documents to the proofreader with the ignored words of the project", () => {
    useDictionary.setState({ global: ["oleafly"], ignored: { p1: ["teh"] } });
    expect(
      spellHost().proofread({
        projectId: "p1",
        path: "main.tex",
        revision: 4,
        surface: "source",
        text: "Hello",
        format: "latex",
        mode: "full",
        preferences: { showRegionalism: false },
      }),
    ).toBe("proofread");
    expect(mocks.proofreadDocument).toHaveBeenCalledWith({
      cacheKey: spellHost().getProofreadingContextKey("p1"),
      identity: { projectId: "p1", path: "main.tex", revision: 4, surface: "source" },
      text: "Hello",
      format: "latex",
      mode: "full",
      preferences: { showRegionalism: false, dictionaryLocale: currentDictionaryLocale() },
      ignoredWords: ["oleafly", "teh"],
    });

    spellHost().proofread({ projectId: null, path: "x.tex", revision: 1, surface: "source", text: "", format: "latex", mode: "full", preferences: {} });
    expect(mocks.proofreadDocument.mock.calls[1][0]).toMatchObject({ ignoredWords: ["oleafly"] });
  });

  it("reads retained results and spelling suggestions through the client", () => {
    expect(
      spellHost().getRetainedProofreading({
        contextKey: "ctx",
        projectId: "p1",
        path: "main.tex",
        text: "Hello",
        mode: "full",
      }),
    ).toBe("retained");
    expect(mocks.getRetainedProofreadingResult).toHaveBeenCalledWith({
      cacheKey: "ctx",
      projectId: "p1",
      path: "main.tex",
      text: "Hello",
      mode: "full",
      surface: "source",
    });
    expect(spellHost().suggest("teh")).toBe("suggestions");
    expect(mocks.suggestSpelling).toHaveBeenCalledWith("teh", currentDictionaryLocale());
  });
});

describe("project-wide providers", () => {
  it("reports the resolved Typst version", () => {
    useFilesStore.setState({
      engine: { ...useFilesStore.getState().engine, typst_resolved: { version: "0.13.1" } } as never,
    });
    expect(captured.typstVersion?.()).toBe("0.13.1");
    useFilesStore.setState({
      engine: { ...useFilesStore.getState().engine, typst_resolved: undefined } as never,
    });
    expect(captured.typstVersion?.()).toBeNull();
  });

  it("lists the project's CSL style files", () => {
    useFilesStore.setState({
      tree: [
        { path: "styles/apa.csl", is_dir: false },
        { path: "IEEE.CSL", is_dir: false },
        { path: "folder.csl", is_dir: true },
        { path: "main.typ", is_dir: false },
      ] as never,
    });
    expect(captured.csl?.()).toEqual(["/styles/apa.csl", "/IEEE.CSL"]);
  });

  it("offers citation keys from open bib files and the project index", () => {
    useFilesStore.setState({
      files: {
        "refs.bib": { content: "@article{knuth, title={T}}", dirty: false },
        "main.tex": { content: "\\cite{x}", dirty: false },
      },
    });
    useIndexStore.setState({
      intelligenceState: {
        identity: { projectId: "p1" },
        data: {
          detectedPackages: [],
          documentClasses: [],
          bibliography: { entries: [{ key: "lamport" }, { key: "knuth" }] },
        },
      } as never,
    });
    expect(captured.bibKeys?.()).toEqual(["knuth", "lamport"]);

    useIndexStore.setState({
      intelligenceState: { identity: { projectId: "other" }, data: null } as never,
    });
    expect(captured.bibKeys?.()).toEqual(["knuth"]);

    useIndexStore.setState({
      intelligenceState: { identity: { projectId: "p1" }, data: null } as never,
    });
    expect(captured.bibKeys?.()).toEqual(["knuth"]);
  });

  it("translates visual editor messages from the editor catalog", () => {
    expect(captured.wysiwygTranslator?.("block.abstract")).toBe("Abstract");
  });
});

describe("the editor host", () => {
  it("resolves visual images with their kind", async () => {
    const ports = mountProps().host.visualPorts as VisualPorts;
    mocks.resolveVisualAsset.mockResolvedValueOnce({ url: "asset://a", path: "figs/a.SVG" });
    await expect(ports.resolveImage("figs/a.SVG")).resolves.toEqual({ url: "asset://a", kind: "svg" });
    mocks.resolveVisualAsset.mockResolvedValueOnce({ url: "asset://b", path: "b.pdf" });
    await expect(ports.resolveImage("b.pdf")).resolves.toEqual({ url: "asset://b", kind: "pdf" });
    mocks.resolveVisualAsset.mockResolvedValueOnce({ url: "asset://c", path: "c.png" });
    await expect(ports.resolveImage("c.png")).resolves.toEqual({ url: "asset://c", kind: "raster" });
    mocks.resolveVisualAsset.mockResolvedValueOnce(null);
    await expect(ports.resolveImage("missing.png")).resolves.toBeNull();
  });

  it("opens the figure editor and looks up reference kinds", () => {
    const ports = mountProps().host.visualPorts as VisualPorts;
    required(ports.openFigureEditor, "openFigureEditor")({ from: 1, to: 9 });
    expect(mocks.openVisualFigureEditor).toHaveBeenCalledWith({ from: 1, to: 9 });
    expect(required(ports.referenceKind, "referenceKind")("fig:a")).toBe("figure");
    expect(mocks.referenceKindIn).toHaveBeenCalledWith(useIndexStore.getState().index, "fig:a");
  });

  it("reads and writes buffers and the math preview setting", () => {
    const { host } = mountProps();
    useFilesStore.setState({ files: { "main.tex": { content: "x", dirty: false } } });
    expect(host.getContent("main.tex")).toBe("x");
    expect(host.getContent("missing.tex")).toBe("");
    const setMathPreview = required(host.setMathPreview, "setMathPreview");
    setMathPreview(false);
    expect(useSettingsStore.getState().editorMathPreview).toBe(false);
    setMathPreview(true);
    expect(useSettingsStore.getState().editorMathPreview).toBe(true);
  });

  it("adds language extensions only to source files", () => {
    const { extraExtensionsForPath } = mountProps();
    expect(extraExtensionsForPath(null)).toEqual([]);
    expect(extraExtensionsForPath("image.png")).toEqual([]);
    const latex = extraExtensionsForPath("main.tex");
    const typst = extraExtensionsForPath("main.typ");
    const markdown = extraExtensionsForPath("notes.md");
    expect(markdown.length).toBeGreaterThan(0);
    expect(latex.length).toBeGreaterThan(markdown.length);
    expect(typst.length).toBeGreaterThan(markdown.length);
  });
});

describe("extra key bindings", () => {
  it("closes environments on Enter only when both auto-close settings are on", () => {
    const enter = binding(mountProps().extraKeymap, "Enter");
    const view = new EditorView({ state: EditorState.create({ doc: "x" }) });
    useSettingsStore.setState({ editorAutoCloseBrackets: true, editorAutoCloseEnvironments: true });
    expect(enter(view)).toBe(true);
    expect(mocks.closeEnvironmentOnEnter).toHaveBeenCalledWith(view);
    useSettingsStore.setState({ editorAutoCloseEnvironments: false });
    expect(enter(view)).toBe(false);
    useSettingsStore.setState({ editorAutoCloseBrackets: false, editorAutoCloseEnvironments: true });
    expect(enter(view)).toBe(false);
    expect(mocks.closeEnvironmentOnEnter).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("toggles an inline AI edit with Mod-L", () => {
    const toggle = binding(mountProps().extraKeymap, "Mod-l");
    const view = new EditorView({
      state: EditorState.create({ doc: "hello world", selection: { anchor: 0, head: 5 } }),
    });
    expect(toggle(view)).toBe(true);
    expect(useInlineEditStore.getState().session).toMatchObject({ original: "hello" });
    toggle(view);
    expect(useInlineEditStore.getState().session).toBeNull();
    view.destroy();
  });
});

describe("turning proofreading off", () => {
  it("cancels both surfaces when the last provider is switched off", () => {
    useSettingsStore.setState({ spellcheck: true, harper: true });
    mountProps();
    useSettingsStore.setState({ spellcheck: false });
    expect(mocks.cancelProofreading).not.toHaveBeenCalled();
    useSettingsStore.setState({ harper: false });
    expect(mocks.cancelProofreading.mock.calls).toEqual([["source"], ["visual"]]);
    useSettingsStore.setState({ showWordChoice: !useSettingsStore.getState().showWordChoice });
    expect(mocks.cancelProofreading).toHaveBeenCalledTimes(2);
  });

  it("stops listening after unmount", () => {
    useSettingsStore.setState({ spellcheck: true, harper: false });
    const { unmount } = render(<CodeMirrorEditor />);
    unmount();
    useSettingsStore.setState({ spellcheck: false });
    expect(mocks.cancelProofreading).not.toHaveBeenCalled();
  });
});
