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
  return { analysis, compile, computerUseListeners, files };
});

const browserWindowMocks = vi.hoisted(() => ({
  launchBrowser: vi.fn(),
  toggleBrowser: vi.fn(),
}));
vi.mock("@/lib/browser-window", () => ({
  launchBrowser: browserWindowMocks.launchBrowser,
  toggleBrowser: browserWindowMocks.toggleBrowser,
  registerBrowserCuaSurface: () => () => {},
}));

const assistantLayoutMocks = vi.hoisted(() => ({
  sidebarMinimumPercent: vi.fn(() => 48),
  sidebarPanelGroupWidth: vi.fn(() => 825),
  assistantMinimumWidth: vi.fn(() => 480),
}));

const panelHandleMocks = vi.hoisted(() => ({
  resize: vi.fn(),
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
vi.mock("@/components/editor/HistoryModal", () => ({ HistoryModal: () => null }));
vi.mock("@/components/editor/HotkeysModal", () => ({ HotkeysModal: () => null }));
vi.mock("@/components/tour/TourGuide", () => ({ TourGuide: () => null }));
vi.mock("@/components/tools/EquationToolView", () => ({ EquationToolView: () => null }));
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
  const state = { page: "library", toolsOpen: false, goLibrary: vi.fn() };
  return { useHomeViewStore: selectorStore(state) };
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
  resetOpenCompileMarker: () => null,
  shouldCompileOnOpen: () => false,
}));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: vi.fn() }));
vi.mock("@/lib/updater", () => ({
  checkForUpdatesOnStartup: vi.fn(async () => {}),
  openUpdateWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));
vi.mock("@/lib/compile-checkpoint", () => ({ COMPILE_SUCCEEDED_EVENT: "compile" }));
vi.mock("@/lib/compile-sync", () => ({ applyRemoteCompileSuccess: vi.fn() }));
vi.mock("@/lib/assistant-layout", () => assistantLayoutMocks);

describe("project dock layout", () => {
  let dom: JSDOM;
  let root: import("react-dom/client").Root | null = null;

  beforeAll(() => {
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
  });

  beforeEach(async () => {
    document.body.innerHTML = "<div id='root'></div>";
    appState.computerUseListeners.clear();
    assistantLayoutMocks.sidebarMinimumPercent.mockClear();
    assistantLayoutMocks.sidebarPanelGroupWidth.mockClear();
    panelHandleMocks.resize.mockClear();
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
});
