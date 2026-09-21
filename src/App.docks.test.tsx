vi.mock("@/lib/preview-workspace", () => ({ startPreviewWorkspaceBridge: vi.fn(async () => () => {}) }));
vi.mock("@/lib/preview-window", () => ({ restorePreviewWindow: vi.fn(async () => {}) }));
import { JSDOM } from "jsdom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => {
  const files = {
    projectId: "project-1" as string | null,
    projectName: "Paper",
    engineLoaded: false,
    loading: false,
    mainDoc: "main.tex",
    activePath: "main.tex" as string | null,
    files: { "main.tex": { content: "", dirty: false } } as Record<
      string,
      { content: string; dirty: boolean }
    >,
    tree: [] as unknown[],
    refreshProjects: vi.fn(async () => {}),
    refreshTree: vi.fn(async () => {}),
    applyExternalWrite: vi.fn(() => true),
    applyExternalDelete: vi.fn(() => true),
    applyExternalRename: vi.fn(() => true),
    applyProjectStateChanged: vi.fn(async () => true),
  };
  const compile = {
    recompile: vi.fn(async () => {}),
    status: "idle",
    autoCompile: false,
    lastCompileCheckpoint: null,
    lastAttemptIdentity: null,
    reset: vi.fn(),
    restoreFromDisk: vi.fn(async () => false),
  };
  const analysis = {
    snapshot: {
      identity: {
        projectId: null,
        projectRevision: 0,
        filesystemEpoch: 0,
      },
    },
  };
  const computerUseListeners = new Set<() => void>();
  const home = { page: "library" };
  const menuListeners = new Map<string, () => void>();
  return { analysis, compile, computerUseListeners, files, home, menuListeners, tauri: false };
});

const editorControllerMocks = vi.hoisted(() => ({
  editorRedo: vi.fn(),
  editorUndo: vi.fn(),
  editorVimRedo: vi.fn(() => true),
  editorVimUndo: vi.fn(() => true),
  getEditorView: vi.fn<() => { contentDOM: HTMLElement } | null>(() => null),
}));

const codeMirrorMocks = vi.hoisted(() => ({
  findFromDOM: vi.fn<(dom: HTMLElement) => unknown>(() => null),
  redo: vi.fn(() => true),
  undo: vi.fn(() => true),
}));
vi.mock("@codemirror/view", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@codemirror/view")>();
  class PatchedEditorView extends actual.EditorView {}
  Object.defineProperty(PatchedEditorView, "findFromDOM", {
    value: codeMirrorMocks.findFromDOM,
  });
  return { ...actual, EditorView: PatchedEditorView };
});
vi.mock("@codemirror/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@codemirror/commands")>()),
  redo: codeMirrorMocks.redo,
  undo: codeMirrorMocks.undo,
}));

const browserWindowMocks = vi.hoisted(() => ({
  launchBrowser: vi.fn(),
  toggleBrowser: vi.fn(),
}));
vi.mock("@/lib/browser-window", () => ({
  launchBrowser: browserWindowMocks.launchBrowser,
  toggleBrowser: browserWindowMocks.toggleBrowser,
  registerBrowserCuaSurface: () => () => {},
}));
vi.mock("@/lib/ai-tools", () => ({
  initAiPdfCaptureFlag: vi.fn(),
}));
vi.mock("@/lib/mcp-bridge", () => ({
  startMcpBridge: vi.fn(async () => () => {}),
}));

const assistantLayoutMocks = vi.hoisted(() => ({
  sidebarMinimumPercent: vi.fn(() => 48),
  sidebarPanelGroupWidth: vi.fn(() => 825),
  assistantMinimumWidth: vi.fn(() => 480),
}));

const panelHandleMocks = vi.hoisted(() => ({
  resize: vi.fn(),
  callbacks: new Map<string, { collapse?: () => void; expand?: () => void }>(),
}));

function selectorStore<T extends object>(state: T) {
  const store = (selector: (value: T) => unknown) => selector(state);
  store.getState = () => state;
  return store;
}

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  const Panel = React.forwardRef(
    (
      props: {
        children?: React.ReactNode;
        defaultSize?: number;
        id: string;
        onCollapse?: () => void;
        onExpand?: () => void;
      },
      ref: React.ForwardedRef<{
        collapse: () => void;
        expand: () => void;
        getSize: () => number;
        isCollapsed: () => boolean;
        isExpanded: () => boolean;
        resize: (size: number) => void;
      }>,
    ) => {
      const initiallyExpanded = (props.defaultSize ?? 0) > 0;
      const expanded = React.useRef(initiallyExpanded);
      const size = React.useRef(props.defaultSize ?? 30);
      React.useImperativeHandle(ref, () => ({
        collapse: () => {
          expanded.current = false;
          props.onCollapse?.();
        },
        expand: () => {
          expanded.current = true;
          props.onExpand?.();
        },
        getSize: () => (expanded.current ? size.current : 0),
        isCollapsed: () => !expanded.current,
        isExpanded: () => expanded.current,
        resize: (nextSize) => {
          size.current = nextSize;
          panelHandleMocks.resize(props.id, nextSize);
        },
      }));
      panelHandleMocks.callbacks.set(props.id, {
        collapse: props.onCollapse,
        expand: props.onExpand,
      });
      React.useEffect(() => {
        if (!initiallyExpanded) return;
        setTimeout(() => props.onExpand?.(), 0);
      }, []);
      return props.children;
    },
  );
  return {
    Panel,
    PanelGroup: ({ children }: { children?: React.ReactNode }) => children,
    PanelResizeHandle: ({ children }: { children?: React.ReactNode }) => children,
  };
});

vi.mock("@/lib/theme", () => ({
  ThemeProvider: ({ children }: { children?: unknown }) => children,
  useAppTheme: () => "dark",
  currentTheme: () => "dark",
  applyAccentColor: vi.fn(),
  subscribeTheme: () => () => {},
}));
vi.mock("@/components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children?: unknown }) => children,
}));
vi.mock("@/components/layout/TopToolbar", () => ({ TopToolbar: () => null }));
vi.mock("@/components/layout/BackendProtocolBanner", () => ({
  BackendProtocolBanner: () => null,
}));
vi.mock("@/components/dock/TerminalPane", () => ({ TerminalPane: () => null }));
vi.mock("@/components/editor/Editor", () => ({ Editor: () => null }));
vi.mock("@/components/editor/cm/controller", () => editorControllerMocks);
vi.mock("@/components/preview/PreviewPane", () => ({ PreviewPane: () => null }));
vi.mock("@/components/import/PdfImportView", () => ({ PdfImportView: () => null }));
vi.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/layout/SearchOmnibar", () => ({ SearchOmnibar: () => null }));
vi.mock("@/components/library/GlobalNewProject", () => ({ GlobalNewProject: () => null }));
vi.mock("@/components/tools/BibtexToolView", () => ({ BibtexToolView: () => null }));
vi.mock("@/components/tools/TableToolView", () => ({ TableToolView: () => null }));
vi.mock("@/components/deadlines/DeadlinesView", () => ({ DeadlinesView: () => null }));
vi.mock("@/components/tools/LatexToolsView", () => ({ LatexToolsView: () => null }));
vi.mock("@/components/tools/LabSearchToolView", () => ({ LabSearchToolView: () => null }));
vi.mock("@/components/editor/LanguageServiceRuntimeBoundary", () => ({
  LanguageServiceRuntimeBoundary: () => null,
  LanguageServiceRuntimeUnavailable: () => null,
}));
vi.mock("@/components/library/Library", () => ({ Library: () => null }));
vi.mock("@/components/ai/ExternalToolApprovals", () => ({
  ExternalToolApprovals: () => null,
}));
vi.mock("@/components/layout/AboutModal", () => ({ AboutModal: () => null }));
vi.mock("@/components/layout/EnginePickerModal", () => ({ EnginePickerModal: () => null }));
vi.mock("@/components/layout/TinytexGuards", () => ({ TinytexGuards: () => null }));
vi.mock("@/components/layout/QuitGuard", () => ({ QuitGuard: () => null }));
vi.mock("@/components/layout/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("@/components/diagram/DiagramComposer", () => ({ DiagramComposer: () => null }));
vi.mock("@/components/ai/CopilotOverlay", () => ({ CopilotOverlay: () => null }));
vi.mock("@/components/editor/WordCountModal", () => ({ WordCountModal: () => null }));
vi.mock("@/components/editor/VersioningModal", () => ({
  VersioningModal: () => <div data-testid="versioning-modal" />,
}));
vi.mock("@/components/editor/HotkeysModal", () => ({ HotkeysModal: () => null }));
vi.mock("@/components/tour/TourGuide", () => ({ TourGuide: () => null }));
vi.mock("@/components/tools/EquationToolView", () => ({ EquationToolView: () => null }));
vi.mock("@/components/tools/GeneratorsToolView", () => ({
  GeneratorsToolView: () => <div data-testid="generators-tool-view" />,
}));
vi.mock("@/components/tools/SymbolsToolView", () => ({
  SymbolsToolView: () => <div data-testid="symbols-tool-view" />,
}));
vi.mock("@/components/tools/LiteratureSearchToolView", () => ({
  LiteratureSearchToolView: () => null,
}));
vi.mock("@/lib/boot-telemetry", () => ({
  dismissBootSplash: vi.fn(),
  markBootStage: vi.fn(),
}));
vi.mock("@/store/files", () => ({
  useFilesStore: selectorStore(appState.files),
  useActiveContent: () => "",
}));
vi.mock("@/store/compile", () => ({
  isCompileCheckpointCurrent: () => false,
  useCompileStore: selectorStore(appState.compile),
}));
vi.mock("@/store/project-analysis", () => ({
  useProjectAnalysisStore: selectorStore(appState.analysis),
}));
vi.mock("@/store/preflight", () => ({
  usePreflightStore: { getState: () => ({ reset: vi.fn() }) },
}));
vi.mock("@/store/home-view", () => {
  return { useHomeViewStore: selectorStore(appState.home) };
});
vi.mock("@/store/tours", () => ({
  useTourStore: { getState: () => ({ activeTourId: null }) },
}));
vi.mock("@/store/git-status", () => ({
  useGitStatusStore: selectorStore({ refresh: vi.fn() }),
}));
vi.mock("@/store/github", () => ({
  useGithubStore: { getState: () => ({ refresh: vi.fn(async () => {}) }) },
}));
vi.mock("@/lib/agent-item-effects", () => ({
  subscribeToComputerUseStarts: (listener: () => void) => {
    appState.computerUseListeners.add(listener);
    return () => appState.computerUseListeners.delete(listener);
  },
}));
vi.mock("@/lib/open-compile", () => ({
  openCompileHydrated: () => false,
  resetOpenCompileMarker: () => null,
  shouldCompileOnOpen: () => false,
}));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/updater", () => ({
  checkForUpdatesOnStartup: vi.fn(async () => {}),
  openUpdateWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => appState.tauri,
  invoke: vi.fn(async () => ({})),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (event: string, handler: () => void) => {
    appState.menuListeners.set(event, handler);
    return () => appState.menuListeners.delete(event);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("@/lib/compile-checkpoint", () => ({ COMPILE_SUCCEEDED_EVENT: "compile" }));
vi.mock("@/lib/compile-sync", () => ({ applyRemoteCompileSuccess: vi.fn() }));
vi.mock("@/lib/assistant-layout", () => assistantLayoutMocks);

describe("project dock layout", () => {
  let dom: JSDOM;
  let root: import("react-dom/client").Root | null = null;

  beforeAll(async () => {
    dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
      url: "https://oleafly.test",
    });
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Element", dom.window.Element);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("CustomEvent", dom.window.CustomEvent);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();
    // Account for cold module loading in setup, outside the interaction budget.
    await import("./App");
  });

  beforeEach(async () => {
    document.body.innerHTML = "<div id='root'></div>";
    appState.computerUseListeners.clear();
    appState.menuListeners.clear();
    appState.tauri = false;
    editorControllerMocks.editorRedo.mockClear();
    editorControllerMocks.editorUndo.mockClear();
    editorControllerMocks.editorVimRedo.mockClear();
    editorControllerMocks.editorVimUndo.mockClear();
    editorControllerMocks.getEditorView.mockReset().mockReturnValue(null);
    codeMirrorMocks.findFromDOM.mockReset().mockReturnValue(null);
    codeMirrorMocks.redo.mockClear();
    codeMirrorMocks.undo.mockClear();
    assistantLayoutMocks.sidebarMinimumPercent.mockClear();
    assistantLayoutMocks.sidebarPanelGroupWidth.mockClear();
    panelHandleMocks.resize.mockClear();
    panelHandleMocks.callbacks.clear();
    localStorage.clear();
    appState.home.page = "library";
    const { useSettingsStore } = await import("@/store/settings");
    useSettingsStore.setState({
      webBrowser: true,
      browserOpen: false,
      terminalOpen: false,
      showTree: false,
      chatFloating: false,
      railTab: "files",
      appFontSize: 16,
      viewMode: "split",
      defaultView: "editor-preview",
      openInTree: false,
      vim: false,
    });
  });

  afterAll(() => {
    dom.window.close();
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    const { act } = await import("react");
    await act(async () => root?.unmount());
    root = null;
  });

  it("keeps both dock flags closed when expanded panels autofire on project mount", async () => {
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(useSettingsStore.getState()).toMatchObject({
      browserOpen: false,
      terminalOpen: false,
    });
  });

  it("mounts the versioning window as one modal surface", async () => {
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.querySelector('[data-testid="versioning-modal"]')).not.toBeNull();
  });

  it.each(["generators", "symbols"])("keeps the project open under the %s tool", async (page) => {
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    appState.home.page = page;
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });

    expect(document.querySelector(`[data-testid="${page}-tool-view"]`)).not.toBeNull();
    expect(document.querySelector('[data-sidebar-open] > .contents')?.hasAttribute("inert")).toBe(true);
  });

  it("passes the app font size into the sidebar width floor", async () => {
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    useSettingsStore.setState({ appFontSize: 20 });
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });

    expect(assistantLayoutMocks.sidebarPanelGroupWidth).toHaveBeenCalledWith(0, 20);
    expect(assistantLayoutMocks.sidebarMinimumPercent).toHaveBeenCalledWith(825, false, 20);
  });

  it("restores the sidebar default width when the sidebar reopens", async () => {
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    useSettingsStore.setState({
      showTree: true,
      viewMode: "pdf",
      openInTree: true,
    });
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    expect(useSettingsStore.getState()).toMatchObject({ showTree: true });
    panelHandleMocks.resize.mockClear();

    await act(async () => {
      useSettingsStore.getState().toggleTree();
    });
    expect(useSettingsStore.getState()).toMatchObject({ showTree: false });
    await act(async () => {
      useSettingsStore.getState().toggleTree();
    });

    expect(useSettingsStore.getState()).toMatchObject({ showTree: true });
    expect(panelHandleMocks.resize).toHaveBeenLastCalledWith("sidebar", expect.any(Number));
  });

  it("reopens the terminal when its panel is dragged back up after collapsing", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    useSettingsStore.setState({ terminalOpen: true });
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const terminal = panelHandleMocks.callbacks.get("terminal");
    expect(terminal?.collapse).toBeTypeOf("function");
    expect(terminal?.expand).toBeTypeOf("function");

    await act(async () => {
      terminal?.collapse?.();
    });
    expect(useSettingsStore.getState().terminalOpen).toBe(false);

    await act(async () => {
      terminal?.expand?.();
    });
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
  });

  it("toggles project docks from their registered keyboard shortcuts", async () => {
    const React = await import("react");
    const { act } = React;
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "`",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(useSettingsStore.getState().terminalOpen).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          key: "b",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(browserWindowMocks.toggleBrowser).toHaveBeenCalled();
  });

  it("opens the shortcut reference unless the editor consumed the chord", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });

    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const content = document.createElement("div");
    content.className = "cm-content";
    content.tabIndex = 0;
    editor.append(content);
    document.body.append(editor);
    const consume = (event: KeyboardEvent) => event.preventDefault();
    content.addEventListener("keydown", consume);

    await act(async () => {
      content.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useSettingsStore.getState().hotkeysOpen).toBe(false);

    content.removeEventListener("keydown", consume);
    await act(async () => {
      content.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useSettingsStore.getState().hotkeysOpen).toBe(true);
    useSettingsStore.setState({ hotkeysOpen: false });

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(useSettingsStore.getState().hotkeysOpen).toBe(true);
    useSettingsStore.setState({ hotkeysOpen: false });

    await act(async () => {
      const handled = new window.KeyboardEvent("keydown", {
        key: "/",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      handled.preventDefault();
      window.dispatchEvent(handled);
    });
    expect(useSettingsStore.getState().hotkeysOpen).toBe(false);

    editor.remove();
  });

  it("routes native menu history through Vim when the source editor is focused", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    appState.tauri = true;
    useSettingsStore.setState({ vim: true });
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = 0;
    document.body.append(editor);
    editorControllerMocks.getEditorView.mockReturnValue({ contentDOM: editor });
    editor.focus();

    await act(async () => {
      await Promise.resolve();
    });
    const undo = appState.menuListeners.get("menu://undo");
    const redo = appState.menuListeners.get("menu://redo");
    expect(undo).toBeDefined();
    expect(redo).toBeDefined();

    await act(async () => {
      undo?.();
      redo?.();
    });

    expect(editorControllerMocks.editorVimUndo).toHaveBeenCalledOnce();
    expect(editorControllerMocks.editorVimRedo).toHaveBeenCalledOnce();
    expect(editorControllerMocks.editorUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorRedo).not.toHaveBeenCalled();
  });

  it("routes toolbar history shortcuts through Vim", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    useSettingsStore.setState({ vim: true });
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    const source = document.createElement("div");
    source.className = "cm-content";
    const toolbarButton = document.createElement("button");
    document.body.append(source, toolbarButton);
    editorControllerMocks.getEditorView.mockReturnValue({ contentDOM: source });
    toolbarButton.focus();

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "z",
        }),
      );
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: "y",
        }),
      );
    });

    expect(editorControllerMocks.editorVimUndo).toHaveBeenCalledOnce();
    expect(editorControllerMocks.editorVimRedo).toHaveBeenCalledOnce();
    expect(editorControllerMocks.editorUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorRedo).not.toHaveBeenCalled();
  });

  it("runs native menu history on the focused CodeMirror surface's own view", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    appState.tauri = true;
    useSettingsStore.setState({ vim: true });
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    const source = document.createElement("div");
    source.className = "cm-content";
    const secondaryWrapper = document.createElement("div");
    secondaryWrapper.className = "cm-editor";
    const secondary = document.createElement("div");
    secondary.className = "cm-content";
    secondary.contentEditable = "true";
    secondary.tabIndex = 0;
    secondaryWrapper.append(secondary);
    document.body.append(source, secondaryWrapper);
    editorControllerMocks.getEditorView.mockReturnValue({ contentDOM: source });
    const secondaryView = { id: "secondary-view" };
    codeMirrorMocks.findFromDOM.mockReturnValue(secondaryView);
    secondary.focus();

    const undo = appState.menuListeners.get("menu://undo");
    const redo = appState.menuListeners.get("menu://redo");
    expect(undo).toBeDefined();
    expect(redo).toBeDefined();
    await act(async () => {
      undo?.();
      redo?.();
    });

    expect(codeMirrorMocks.findFromDOM).toHaveBeenCalledWith(secondaryWrapper);
    expect(codeMirrorMocks.undo).toHaveBeenCalledWith(secondaryView);
    expect(codeMirrorMocks.redo).toHaveBeenCalledWith(secondaryView);
    expect(editorControllerMocks.editorVimUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorVimRedo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorRedo).not.toHaveBeenCalled();
  });

  it("leaves the source buffer alone when a secondary CodeMirror view cannot be resolved", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    appState.tauri = true;
    useSettingsStore.setState({ vim: true });
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    const source = document.createElement("div");
    source.className = "cm-content";
    const secondary = document.createElement("div");
    secondary.className = "cm-content";
    secondary.contentEditable = "true";
    secondary.tabIndex = 0;
    document.body.append(source, secondary);
    editorControllerMocks.getEditorView.mockReturnValue({ contentDOM: source });
    codeMirrorMocks.findFromDOM.mockReturnValue(null);
    secondary.focus();

    const undo = appState.menuListeners.get("menu://undo");
    const redo = appState.menuListeners.get("menu://redo");
    await act(async () => {
      undo?.();
      redo?.();
    });

    expect(codeMirrorMocks.findFromDOM).toHaveBeenCalledWith(secondary);
    expect(codeMirrorMocks.undo).not.toHaveBeenCalled();
    expect(codeMirrorMocks.redo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorVimUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorVimRedo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorRedo).not.toHaveBeenCalled();
  });

  it("routes native menu history from the visual editor through the app controller", async () => {
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { default: App } = await import("./App");
    const { useSettingsStore } = await import("@/store/settings");
    const host = document.getElementById("root");
    if (!host) throw new Error("test root is unavailable");
    appState.tauri = true;
    useSettingsStore.setState({ vim: true });
    root = createRoot(host);

    await act(async () => {
      root?.render(<App />);
    });
    const source = document.createElement("div");
    source.className = "cm-content";
    const visual = document.createElement("div");
    visual.className = "ProseMirror";
    visual.contentEditable = "true";
    visual.tabIndex = 0;
    document.body.append(source, visual);
    editorControllerMocks.getEditorView.mockReturnValue({ contentDOM: source });
    visual.focus();

    const undo = appState.menuListeners.get("menu://undo");
    const redo = appState.menuListeners.get("menu://redo");
    expect(undo).toBeDefined();
    expect(redo).toBeDefined();
    await act(async () => {
      undo?.();
      redo?.();
    });

    expect(editorControllerMocks.editorVimUndo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorVimRedo).not.toHaveBeenCalled();
    expect(editorControllerMocks.editorUndo).toHaveBeenCalledOnce();
    expect(editorControllerMocks.editorRedo).toHaveBeenCalledOnce();
  });
});
