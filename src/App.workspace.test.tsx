// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enWorkspace from "@/i18n/locales/en/workspace.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  tauri: false,
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  openUpdateWindow: vi.fn(),
  checkForUpdatesOnStartup: vi.fn(async () => {}),
  forwardFromCursor: vi.fn(),
  applyExternalFileChange: vi.fn(),
  refreshOpenFilesFromDisk: vi.fn(),
  applyRemoteCompileSuccess: vi.fn(),
  preflightReset: vi.fn(),
  gitRefresh: vi.fn(),
  editorUndo: vi.fn(),
  editorRedo: vi.fn(),
  editorVimUndo: vi.fn(() => true),
  editorVimRedo: vi.fn(() => false),
  getEditorView: vi.fn(() => null as { contentDOM: HTMLElement; requestMeasure: () => void } | null),
  stopOutdatedAutomaticCompile: vi.fn(),
  typstLivePreviewWanted: vi.fn(() => false),
  startMcpBridge: vi.fn(async () => () => {}),
  initAiPdfCaptureFlag: vi.fn(),
  sidebarThrows: false,
  previewRenders: 0,
  editorRenders: 0,
}));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => mocks.tauri, invoke: vi.fn(async () => ({})) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.listeners.set(event, handler);
    return () => mocks.listeners.delete(event);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const useFilesStore = create(() => ({
    projectId: "p1" as string | null,
    projectName: "Paper",
    engineLoaded: true,
    loading: false,
    mainDoc: "main.tex",
    mainDecision: "auto",
    activePath: "main.tex" as string | null,
    files: { "main.tex": { content: "a", dirty: false } } as Record<string, { content: string; dirty: boolean }>,
    tree: [] as unknown[],
    refreshProjects: vi.fn(async () => {}),
    applyProjectStateChanged: vi.fn(async () => true),
  }));
  return {
    useFilesStore,
    useActiveContent: () =>
      useFilesStore((state) => (state.activePath ? state.files[state.activePath]?.content ?? "" : "")),
  };
});
vi.mock("@/store/compile", async () => {
  const { create } = await import("zustand");
  const useCompileStore = create(() => ({
    recompile: vi.fn(async () => {}),
    status: "idle",
    autoCompile: false,
    lastCompileCheckpoint: null,
    lastAttemptIdentity: null,
    reset: vi.fn(),
    restoreFromDisk: vi.fn(async () => false),
  }));
  return {
    useCompileStore,
    isCompileCheckpointCurrent: () => false,
    stopOutdatedAutomaticCompile: mocks.stopOutdatedAutomaticCompile,
    typstLivePreviewWanted: mocks.typstLivePreviewWanted,
  };
});
vi.mock("@/store/project-analysis", async () => {
  const { create } = await import("zustand");
  return {
    useProjectAnalysisStore: create(() => ({
      snapshot: { identity: { projectId: null, projectRevision: 0, filesystemEpoch: 0 } },
    })),
  };
});
vi.mock("@/store/home-view", async () => {
  const { create } = await import("zustand");
  const useHomeViewStore = create<{
    page: string;
    queuedPageAfterProjectClose: string | null;
    goTo: (page: string) => void;
    queuePageAfterProjectClose: (page: string) => void;
    consumeQueuedPageAfterProjectClose: () => string | null;
  }>((set, get) => ({
    page: "library",
    queuedPageAfterProjectClose: null,
    goTo: (page) => set({ page }),
    queuePageAfterProjectClose: (page) => set({ queuedPageAfterProjectClose: page }),
    consumeQueuedPageAfterProjectClose: () => {
      const queued = get().queuedPageAfterProjectClose;
      set({ queuedPageAfterProjectClose: null });
      return queued;
    },
  }));
  return { useHomeViewStore };
});
vi.mock("@/store/preflight", () => ({ usePreflightStore: { getState: () => ({ reset: mocks.preflightReset }) } }));
vi.mock("@/store/tours", async () => {
  const { create } = await import("zustand");
  return { useTourStore: create(() => ({ activeTourId: null as string | null })) };
});
vi.mock("@/store/git-status", () => {
  const state = { refresh: mocks.gitRefresh };
  const store = (selector: (value: typeof state) => unknown) => selector(state);
  store.getState = () => state;
  return { useGitStatusStore: store };
});
vi.mock("@/store/github", () => ({ useGithubStore: { getState: () => ({ refresh: vi.fn(async () => {}) }) } }));

vi.mock("@/lib/theme", () => ({
  ThemeProvider: ({ children }: { children?: unknown }) => children,
  applyAccentColor: vi.fn(),
  currentTheme: () => "dark",
  subscribeTheme: () => () => {},
}));
vi.mock("@/lib/boot-telemetry", () => ({ bootSplashHeld: () => false, dismissBootSplash: vi.fn(), markBootStage: vi.fn() }));
vi.mock("@/lib/updater", () => ({
  checkForUpdatesOnStartup: mocks.checkForUpdatesOnStartup,
  openUpdateWindow: mocks.openUpdateWindow,
}));
vi.mock("@/features/synctex", () => ({ forwardFromCursor: mocks.forwardFromCursor }));
vi.mock("@/lib/external-file-changes", () => ({
  applyExternalFileChange: mocks.applyExternalFileChange,
  refreshOpenFilesFromDisk: mocks.refreshOpenFilesFromDisk,
}));
vi.mock("@/lib/compile-sync", () => ({ applyRemoteCompileSuccess: mocks.applyRemoteCompileSuccess }));
vi.mock("@/lib/compile-checkpoint", () => ({ COMPILE_SUCCEEDED_EVENT: "compile-succeeded" }));
vi.mock("@/lib/checkpoint-publication", () => ({
  CHECKPOINT_PUBLICATION_EVENT: "checkpoint-publication",
  applyCheckpointPublicationEvent: vi.fn(),
}));
vi.mock("@/lib/preview-workspace", () => ({ startPreviewWorkspaceBridge: vi.fn(async () => () => {}) }));
vi.mock("@/lib/preview-window", () => ({ restorePreviewWindow: vi.fn(async () => {}) }));
vi.mock("@/lib/native-dock-shortcuts", () => ({
  startNativeDockShortcutBridge: vi.fn(async () => () => {}),
  usesNativeDockMenu: () => false,
}));
vi.mock("@/lib/browser-window", () => ({
  registerBrowserCuaSurface: () => () => {},
  toggleBrowser: vi.fn(),
  launchBrowser: vi.fn(),
}));
vi.mock("@/lib/mcp-bridge", () => ({ startMcpBridge: mocks.startMcpBridge }));
vi.mock("@/lib/ai-tools", () => ({ initAiPdfCaptureFlag: mocks.initAiPdfCaptureFlag }));
vi.mock("@/lib/open-compile", () => ({
  automaticCompileAllowed: () => true,
  openCompileHydrated: () => false,
  resetOpenCompileMarker: () => null,
  settleOpenCompile: () => ({ compiled: true, retries: null }),
  shouldCompileOnOpen: () => false,
}));
vi.mock("@/components/editor/cm/controller", () => ({
  editorUndo: mocks.editorUndo,
  editorRedo: mocks.editorRedo,
  editorVimUndo: mocks.editorVimUndo,
  editorVimRedo: mocks.editorVimRedo,
  getEditorView: mocks.getEditorView,
}));

vi.mock("@/components/layout/TopToolbar", () => ({ TopToolbar: () => <div data-testid="top-toolbar" /> }));
vi.mock("@/components/layout/BackendProtocolBanner", () => ({ BackendProtocolBanner: () => null }));
vi.mock("@/components/layout/FolderUnavailableBanner", () => ({ FolderUnavailableBanner: () => null }));
vi.mock("@/components/open-folder/MainDocumentPicker", () => ({ MainDocumentPicker: () => null }));
vi.mock("@/components/open-folder/OpenedFolderBanners", () => ({ OpenedFolderBanners: () => null }));
vi.mock("@/components/layout/ShellCommandsBanner", () => ({ ShellCommandsBanner: () => null }));
vi.mock("@/components/open-folder/OpenFolderKeeper", () => ({ OpenFolderKeeper: () => null }));
vi.mock("@/components/layout/ProjectAvailabilityKeeper", () => ({ ProjectAvailabilityKeeper: () => null }));
vi.mock("@/components/layout/FolderWatchKeeper", () => ({ FolderWatchKeeper: () => null }));
vi.mock("@/components/editor/Editor", () => ({
  Editor: () => {
    mocks.editorRenders++;
    return <div data-testid="editor-surface" />;
  },
}));
vi.mock("@/components/preview/PreviewPane", () => ({
  PreviewPane: () => {
    mocks.previewRenders++;
    return <div data-testid="preview-surface" />;
  },
}));
vi.mock("@/components/import/PdfImportView", () => ({ PdfImportView: () => <div data-testid="tool-pdf-import" /> }));
vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => {
    if (mocks.sidebarThrows) throw new Error("sidebar crashed");
    return <div data-testid="sidebar-surface" />;
  },
}));
vi.mock("@/components/layout/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/layout/SearchOmnibar", () => ({ SearchOmnibar: () => null }));
vi.mock("@/components/library/GlobalNewProject", () => ({ GlobalNewProject: () => null }));
vi.mock("@/components/library/CopyIntoLibraryDialog", () => ({ CopyIntoLibraryDialog: () => null }));
vi.mock("@/components/tools/BibtexToolView", () => ({ BibtexToolView: () => <div data-testid="tool-bibtex" /> }));
vi.mock("@/components/tools/TableToolView", () => ({ TableToolView: () => <div data-testid="tool-table" /> }));
vi.mock("@/components/deadlines/DeadlinesView", () => ({ DeadlinesView: () => <div data-testid="tool-deadlines" /> }));
vi.mock("@/components/tools/LatexToolsView", () => ({ LatexToolsView: () => <div data-testid="tool-tools" /> }));
vi.mock("@/components/tools/LabSearchToolView", () => ({ LabSearchToolView: () => <div data-testid="tool-lab-search" /> }));
vi.mock("@/components/tools/StatsToolView", () => ({ StatsToolView: () => <div data-testid="tool-stats" /> }));
vi.mock("@/components/tools/GeneratorsToolView", () => ({ GeneratorsToolView: () => <div data-testid="tool-generators" /> }));
vi.mock("@/components/tools/SymbolsToolView", () => ({ SymbolsToolView: () => <div data-testid="tool-symbols" /> }));
vi.mock("@/components/tools/EquationToolView", () => ({ EquationToolView: () => <div data-testid="tool-equation" /> }));
vi.mock("@/components/tools/ConverterToolView", () => ({ ConverterToolView: () => <div data-testid="tool-converter" /> }));
vi.mock("@/components/tools/ReferenceToolView", () => ({ ReferenceToolView: () => <div data-testid="tool-reference" /> }));
vi.mock("@/components/tools/LiteratureSearchToolView", () => ({
  LiteratureSearchToolView: () => <div data-testid="tool-literature-search" />,
}));
vi.mock("@/components/editor/LanguageServiceRuntimeBoundary", () => ({
  LanguageServiceRuntimeBoundary: () => null,
  LanguageServiceRuntimeUnavailable: () => null,
}));
vi.mock("@/components/library/Library", () => ({ Library: () => <div data-testid="library" /> }));
vi.mock("@/components/ai/AssistantOutputsBridge", () => ({ AssistantOutputsBridge: () => null }));
vi.mock("@/components/ai/ExternalToolApprovals", () => ({ ExternalToolApprovals: () => null }));
vi.mock("@/components/ai/ChatPanel", () => ({ ChatPanel: () => <div data-testid="chat-surface" /> }));
vi.mock("@/components/ai/CopilotOverlay", () => ({ CopilotOverlay: () => <div data-testid="copilot-overlay" /> }));
vi.mock("@/components/layout/AboutModal", () => ({
  AboutModal: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <button type="button" data-testid="about" onClick={onClose} />
    ) : null,
}));
vi.mock("@/components/layout/EnginePickerModal", () => ({ EnginePickerModal: () => null }));
vi.mock("@/components/layout/TinytexGuards", () => ({ TinytexGuards: () => null }));
vi.mock("@/components/layout/QuitGuard", () => ({ QuitGuard: () => null }));
vi.mock("@/components/layout/SaveBlockedDialog", () => ({ SaveBlockedDialog: () => null }));
vi.mock("@/components/layout/OpenFolderGuards", () => ({ OpenFolderStopDialog: () => null, useOpenFolderIntake: () => {} }));
vi.mock("@/components/layout/QuickActionOffer", () => ({ QuickActionOffer: () => null }));
vi.mock("@/components/layout/CiteOleaflyDialog", () => ({ CiteOleaflyDialog: () => null }));
vi.mock("@/components/layout/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("@/components/diagram/DiagramComposer", () => ({ DiagramComposer: () => null }));
vi.mock("@/components/diagram/composer-chooser/DiagramComposerChooser", () => ({ DiagramComposerChooserHost: () => null }));
vi.mock("@/components/editor/WordCountModal", () => ({ WordCountModal: () => null }));
vi.mock("@/components/editor/VersioningModal", () => ({ VersioningModal: () => null }));
vi.mock("@/components/editor/HotkeysModal", () => ({ HotkeysModal: () => null }));
vi.mock("@/components/tour/TourGuide", () => ({ TourGuide: () => null }));
vi.mock("@/components/dock/TerminalDock", () => ({ TerminalDock: () => <div data-testid="terminal-dock" /> }));
vi.mock("@/lib/crash-report", () => ({ reportCrashToGithub: vi.fn(async () => {}) }));

import App from "./App";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useHomeViewStore } from "@/store/home-view";
import { useTourStore } from "@/store/tours";
import { useSettingsStore } from "@/store/settings";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { useProjectAnalysisStore } from "@/store/project-analysis";

const initialFiles = useFilesStore.getState();
const initialCompile = useCompileStore.getState();
const initialSettings = useSettingsStore.getState();

function emit(event: string, payload: unknown) {
  const handler = mocks.listeners.get(event);
  if (!handler) throw new Error(`no listener for ${event}`);
  act(() => handler({ payload }));
}

function keydown(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function savedLayout(layout: { viewMode?: string; showTree?: boolean; assistantOpen?: boolean; workspaceHidden?: boolean }) {
  localStorage.setItem("oleafly.workspace.p1", JSON.stringify({ version: 1, ...layout }));
}

async function renderApp() {
  const view = render(<App />);
  await act(async () => {});
  return view;
}

beforeEach(() => {
  mocks.tauri = false;
  mocks.sidebarThrows = false;
  mocks.listeners.clear();
  vi.clearAllMocks();
  mocks.editorVimUndo.mockReturnValue(true);
  mocks.editorVimRedo.mockReturnValue(false);
  mocks.getEditorView.mockReturnValue(null);
  mocks.typstLivePreviewWanted.mockReturnValue(false);
  useFilesStore.setState(
    {
      ...initialFiles,
      projectId: "p1",
      activePath: "main.tex",
      files: { "main.tex": { content: "a", dirty: false } },
      applyProjectStateChanged: vi.fn(async () => true),
    },
    true,
  );
  useCompileStore.setState({ ...initialCompile, recompile: vi.fn(async () => undefined), status: "idle", autoCompile: false }, true);
  useHomeViewStore.setState({ page: "library", queuedPageAfterProjectClose: null });
  useTourStore.setState({ activeTourId: null });
  usePreviewDetachedStore.setState({ projectId: null });
  useSettingsStore.setState(
    {
      ...initialSettings,
      viewMode: "split",
      showTree: false,
      chatFloating: false,
      assistantOpen: false,
      workspaceHidden: false,
      terminalOpen: false,
      vim: false,
      defaultView: "editor-preview",
      openInTree: false,
      appFontFamily: "",
      editorFontFamily: "",
    },
    true,
  );
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("style");
});

describe("library view", () => {
  beforeEach(() => {
    useFilesStore.setState({ projectId: null });
  });

  it("returns to the library when no project is open", async () => {
    useHomeViewStore.setState({ page: "stats" });
    await renderApp();
    expect(screen.getByTestId("library")).toBeInTheDocument();
    expect(useHomeViewStore.getState().page).toBe("library");
  });

  it("opens a page queued for after the project closed", async () => {
    useHomeViewStore.getState().queuePageAfterProjectClose("deadlines");
    await renderApp();
    expect(useHomeViewStore.getState().page).toBe("deadlines");
    expect(await screen.findByTestId("tool-deadlines")).toBeInTheDocument();
  });

  it.each([
    "pdf-import",
    "equation",
    "converter",
    "reference",
    "bibtex",
    "table",
    "lab-search",
    "literature-search",
    "deadlines",
    "stats",
    "generators",
    "symbols",
    "tools",
  ] as const)("shows the %s home tool", async (page) => {
    useHomeViewStore.getState().queuePageAfterProjectClose(page);
    await renderApp();
    expect(await screen.findByTestId(`tool-${page}`)).toBeInTheDocument();
    expect(screen.getByTestId("library")).toBeInTheDocument();
  });

  it("shows the floating copilot over the library", async () => {
    useSettingsStore.setState({ chatFloating: true });
    await renderApp();
    expect(await screen.findByTestId("copilot-overlay")).toBeInTheDocument();
  });
});

describe("project workspace", () => {
  it("shows the editor and preview side by side in split view", async () => {
    await renderApp();
    expect(screen.getByTestId("editor-surface")).toBeInTheDocument();
    expect(screen.getByTestId("preview-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("library")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
  });

  it("keeps the workspace still while every edit advances the project revision", async () => {
    await renderApp();
    const renders = { preview: mocks.previewRenders, editor: mocks.editorRenders };

    for (let revision = 1; revision <= 10; revision++) {
      act(() =>
        useProjectAnalysisStore.setState({
          snapshot: { identity: { projectId: "p1", projectRevision: revision, languageServiceGeneration: 0 } } as never,
        }),
      );
    }

    expect(mocks.previewRenders).toBe(renders.preview);
    expect(mocks.editorRenders).toBe(renders.editor);
  });

  it("drops the preview pane while the preview is detached", async () => {
    usePreviewDetachedStore.setState({ projectId: "p1" });
    await renderApp();
    expect(screen.getByTestId("editor-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-surface")).not.toBeInTheDocument();
  });

  it("shows only the preview in PDF view", async () => {
    savedLayout({ viewMode: "pdf" });
    await renderApp();
    expect(screen.queryByTestId("editor-surface")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-surface")).toBeInTheDocument();
  });

  it("shows the assistant next to the document, or alone when the workspace is hidden", async () => {
    savedLayout({ assistantOpen: true, showTree: true });
    const view = await renderApp();
    expect(await screen.findByTestId("chat-surface")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-surface")).toBeInTheDocument();
    expect(screen.getByTestId("editor-surface")).toBeInTheDocument();
    view.unmount();

    savedLayout({ assistantOpen: true, workspaceHidden: true });
    await renderApp();
    expect(await screen.findByTestId("chat-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("editor-surface")).not.toBeInTheDocument();
  });

  it("shows the floating copilot inside a project", async () => {
    useSettingsStore.setState({ chatFloating: true });
    await renderApp();
    expect(await screen.findByTestId("copilot-overlay")).toBeInTheDocument();
  });

  it("keeps the toolbar usable when a workspace panel crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sidebarThrows = true;
    savedLayout({ showTree: true });
    await renderApp();
    expect(screen.getByText(enWorkspace.panelError.message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enWorkspace.panelError.reload })).toBeInTheDocument();
    expect(screen.getByTestId("top-toolbar")).toBeInTheDocument();
  });

  it("applies the chosen fonts to the document root and clears them again", async () => {
    useSettingsStore.setState({ appFontFamily: "Inter", editorFontFamily: "JetBrains Mono", appFontSize: 18 });
    const requestMeasure = vi.fn();
    mocks.getEditorView.mockReturnValue({ contentDOM: document.createElement("div"), requestMeasure });
    await renderApp();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--app-font")).toBe('"Inter"');
    expect(root.style.getPropertyValue("--cm-font-family")).toBe('"JetBrains Mono", var(--font-mono)');
    expect(root.style.fontSize).toBe("18px");
    expect(requestMeasure).toHaveBeenCalled();
    act(() => useSettingsStore.setState({ appFontFamily: "", editorFontFamily: "" }));
    expect(root.style.getPropertyValue("--app-font")).toBe("");
    expect(root.style.getPropertyValue("--cm-font-family")).toBe("");
  });

  it("applies the editor line height and cursor width to the document root", async () => {
    useSettingsStore.setState({ editorLineHeight: "wide", editorCustomLineHeight: 1.55, editorCursorWidth: 1 });
    await renderApp();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--cm-line-height")).toBe("2");
    expect(root.style.getPropertyValue("--cm-cursor-width")).toBe("1px");
    act(() => useSettingsStore.setState({ editorLineHeight: "custom", editorCursorWidth: 3 }));
    expect(root.style.getPropertyValue("--cm-line-height")).toBe("1.55");
    expect(root.style.getPropertyValue("--cm-cursor-width")).toBe("3px");
  });

  it("overrides the cursor color only while a custom one is set", async () => {
    useSettingsStore.setState({ editorCursorColor: "#ff8800" });
    await renderApp();
    const root = document.documentElement;
    expect(root.style.getPropertyValue("--cm-cursor-custom")).toBe("#ff8800");
    act(() => useSettingsStore.setState({ editorCursorColor: "" }));
    expect(root.style.getPropertyValue("--cm-cursor-custom")).toBe("");
  });

  it("falls back to the default editor font when the chosen name is only spaces", async () => {
    useSettingsStore.setState({ editorFontFamily: "   " });
    await renderApp();
    expect(document.documentElement.style.getPropertyValue("--cm-font-family")).toBe("");
  });

  it("refreshes git status and open files when the window regains focus or becomes visible", async () => {
    await renderApp();
    mocks.gitRefresh.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.gitRefresh).toHaveBeenCalledWith("p1");
    expect(mocks.refreshOpenFilesFromDisk).toHaveBeenCalledWith("p1");
    mocks.refreshOpenFilesFromDisk.mockClear();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.refreshOpenFilesFromDisk).toHaveBeenCalledWith("p1");
  });
});

describe("native events", () => {
  beforeEach(() => {
    mocks.tauri = true;
  });

  it("starts the MCP bridge and the PDF capture flag in the desktop shell", async () => {
    await renderApp();
    await waitFor(() => expect(mocks.startMcpBridge).toHaveBeenCalled());
    await waitFor(() => expect(mocks.initAiPdfCaptureFlag).toHaveBeenCalled());
  });

  it("opens the about dialog and the update window from the app menu", async () => {
    await renderApp();
    await waitFor(() => expect(mocks.listeners.has("menu://about")).toBe(true));
    emit("menu://about", null);
    fireEvent.click(screen.getByTestId("about"));
    expect(screen.queryByTestId("about")).not.toBeInTheDocument();
    emit("menu://check-updates", null);
    expect(mocks.openUpdateWindow).toHaveBeenCalledWith({ manual: true });
  });

  it("opens settings at the requested section", async () => {
    await renderApp();
    await waitFor(() => expect(mocks.listeners.has("settings:open")).toBe(true));
    emit("settings:open", { section: "appearance" });
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "appearance" });
    act(() => useSettingsStore.setState({ settingsOpen: false, settingsInitialSection: "general" }));
    emit("settings:open", null);
    expect(useSettingsStore.getState()).toMatchObject({ settingsOpen: true, settingsInitialSection: "general" });
  });

  it("applies file changes and compile results reported by other windows", async () => {
    await renderApp();
    await waitFor(() => expect(mocks.listeners.has("project:files-changed")).toBe(true));
    const change = { projectId: "p1", paths: ["main.tex"] };
    emit("project:files-changed", change);
    emit("project:files-changed", null);
    expect(mocks.applyExternalFileChange).toHaveBeenCalledTimes(1);
    expect(mocks.applyExternalFileChange).toHaveBeenCalledWith(change, "main");
    emit("compile-succeeded", { projectId: "p1" });
    expect(mocks.applyRemoteCompileSuccess).toHaveBeenCalledWith({ projectId: "p1" }, "main");
  });

  it("applies project state changes for the open project and resets preflight when they land", async () => {
    await renderApp();
    await waitFor(() => expect(mocks.listeners.has("project-state-changed")).toBe(true));
    mocks.preflightReset.mockClear();
    const apply = useFilesStore.getState().applyProjectStateChanged as ReturnType<typeof vi.fn>;
    emit("project-state-changed", { projectId: "other" });
    emit("project-state-changed", null);
    expect(apply).not.toHaveBeenCalled();
    emit("project-state-changed", { projectId: "p1" });
    await waitFor(() => expect(mocks.preflightReset).toHaveBeenCalledTimes(1));
    apply.mockResolvedValueOnce(false);
    emit("project-state-changed", { projectId: "p1" });
    await act(async () => {});
    expect(apply).toHaveBeenCalledTimes(2);
    expect(mocks.preflightReset).toHaveBeenCalledTimes(1);
  });

  it("routes menu undo and redo to a focused plain field", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await renderApp();
    await waitFor(() => expect(mocks.listeners.has("menu://undo")).toBe(true));
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    emit("menu://undo", null);
    emit("menu://redo", null);
    expect(execCommand.mock.calls).toEqual([["undo"], ["redo"]]);
    expect(mocks.editorUndo).not.toHaveBeenCalled();
    input.remove();
  });
});

describe("keyboard shortcuts", () => {
  it("recompiles and reveals the preview from the recompile shortcut", async () => {
    savedLayout({ viewMode: "editor" });
    await renderApp();
    const event = keydown(window, { key: "Enter", ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(useCompileStore.getState().recompile).toHaveBeenCalled();
    expect(useSettingsStore.getState().viewMode).toBe("split");
  });

  it("opens settings from the settings shortcut, in a project and in the library", async () => {
    await renderApp();
    const event = keydown(window, { key: ",", ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(useSettingsStore.getState().settingsOpen).toBe(true);

    act(() => useSettingsStore.setState({ settingsOpen: false }));
    act(() => useFilesStore.setState({ projectId: null }));
    keydown(window, { key: ",", ctrlKey: true });
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });

  it("leaves the settings shortcut alone during a tour or once another handler took it", async () => {
    await renderApp();
    act(() => useTourStore.setState({ activeTourId: "home" }));
    keydown(window, { key: ",", ctrlKey: true });
    expect(useSettingsStore.getState().settingsOpen).toBe(false);

    act(() => useTourStore.setState({ activeTourId: null }));
    const field = document.createElement("input");
    document.body.append(field);
    field.addEventListener("keydown", (event) => event.preventDefault());
    keydown(field, { key: ",", ctrlKey: true });
    expect(useSettingsStore.getState().settingsOpen).toBe(false);
    field.remove();
  });

  it("runs forward search and ignores shortcuts during a tour", async () => {
    await renderApp();
    keydown(window, { key: "j", ctrlKey: true, shiftKey: true });
    expect(mocks.forwardFromCursor).toHaveBeenCalledTimes(1);
    act(() => useTourStore.setState({ activeTourId: "home" }));
    keydown(window, { key: "j", ctrlKey: true, shiftKey: true });
    keydown(window, { key: "Enter", ctrlKey: true });
    keydown(window, { key: "b", ctrlKey: true });
    keydown(window, { key: "z", ctrlKey: true });
    expect(mocks.forwardFromCursor).toHaveBeenCalledTimes(1);
    expect(useCompileStore.getState().recompile).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().showTree).toBe(false);
    expect(mocks.editorUndo).not.toHaveBeenCalled();
  });

  it("toggles the sidebar unless an editor has focus", async () => {
    await renderApp();
    keydown(window, { key: "b", ctrlKey: true });
    expect(useSettingsStore.getState().showTree).toBe(true);
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    const content = document.createElement("div");
    content.tabIndex = 0;
    editor.append(content);
    document.body.append(editor);
    content.focus();
    keydown(content, { key: "b", ctrlKey: true });
    expect(useSettingsStore.getState().showTree).toBe(true);
    editor.remove();
  });

  it("ignores the sidebar and history shortcuts in the library", async () => {
    useFilesStore.setState({ projectId: null });
    await renderApp();
    keydown(window, { key: "b", ctrlKey: true });
    keydown(window, { key: "z", ctrlKey: true });
    expect(useSettingsStore.getState().showTree).toBe(false);
    expect(mocks.editorUndo).not.toHaveBeenCalled();
  });

  it("sends undo and redo to the document from the toolbar", async () => {
    await renderApp();
    keydown(window, { key: "z", ctrlKey: true });
    keydown(window, { key: "z", ctrlKey: true, shiftKey: true });
    keydown(window, { key: "y", ctrlKey: true });
    expect(mocks.editorUndo).toHaveBeenCalledTimes(1);
    expect(mocks.editorRedo).toHaveBeenCalledTimes(2);
  });

  it("uses the field's own history inside a text input", async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await renderApp();
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    keydown(input, { key: "z", ctrlKey: true });
    keydown(input, { key: "y", ctrlKey: true });
    expect(execCommand.mock.calls).toEqual([["undo"], ["redo"]]);
    expect(mocks.editorUndo).not.toHaveBeenCalled();
    input.remove();
  });

  it("routes toolbar history through Vim and falls back when Vim declines", async () => {
    useSettingsStore.setState({ vim: true });
    await renderApp();
    keydown(window, { key: "z", ctrlKey: true });
    expect(mocks.editorVimUndo).toHaveBeenCalledTimes(1);
    expect(mocks.editorUndo).not.toHaveBeenCalled();
    keydown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(mocks.editorVimRedo).toHaveBeenCalledTimes(1);
    expect(mocks.editorRedo).toHaveBeenCalledTimes(1);
  });

  it("leaves history keys to Vim inside the source editor and to secondary editors", async () => {
    const source = document.createElement("div");
    source.className = "cm-content";
    source.tabIndex = 0;
    document.body.append(source);
    mocks.getEditorView.mockReturnValue({ contentDOM: source, requestMeasure: vi.fn() });
    useSettingsStore.setState({ vim: true });
    await renderApp();
    source.focus();
    const vimEvent = keydown(source, { key: "z", ctrlKey: true });
    expect(vimEvent.defaultPrevented).toBe(false);

    mocks.getEditorView.mockReturnValue(null);
    const secondary = keydown(source, { key: "z", ctrlKey: true });
    expect(secondary.defaultPrevented).toBe(false);
    expect(mocks.editorUndo).not.toHaveBeenCalled();
    expect(mocks.editorVimUndo).not.toHaveBeenCalled();
    source.remove();
  });
});

describe("automatic compile", () => {
  function edit(content: string) {
    act(() =>
      useFilesStore.setState((state) => ({
        files: { ...state.files, [state.activePath ?? "main.tex"]: { content, dirty: true } },
      })),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    useCompileStore.setState({ autoCompile: true });
  });

  it("compiles after the debounce once the text stops changing", async () => {
    await renderApp();
    edit("ab");
    act(() => vi.advanceTimersByTime(2000));
    edit("abc");
    act(() => vi.advanceTimersByTime(2499));
    const recompile = useCompileStore.getState().recompile;
    expect(recompile).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(recompile).toHaveBeenCalledWith({ origin: "automatic" });
  });

  it("does not compile merely because another file was opened", async () => {
    await renderApp();
    act(() =>
      useFilesStore.setState({
        activePath: "intro.tex",
        files: { "main.tex": { content: "a", dirty: false }, "intro.tex": { content: "x", dirty: false } },
      }),
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(useCompileStore.getState().recompile).not.toHaveBeenCalled();
  });

  it("waits for a running compile, stopping it as outdated, then compiles", async () => {
    await renderApp();
    act(() => useCompileStore.setState({ status: "compiling" }));
    edit("changed");
    act(() => vi.advanceTimersByTime(2500));
    expect(mocks.stopOutdatedAutomaticCompile).toHaveBeenCalledTimes(1);
    expect(useCompileStore.getState().recompile).not.toHaveBeenCalled();
    act(() => useCompileStore.setState({ status: "success" }));
    act(() => vi.advanceTimersByTime(500));
    expect(useCompileStore.getState().recompile).toHaveBeenCalledWith({ origin: "automatic" });
  });

  it("leaves compiling to the Typst live preview when it is active", async () => {
    await renderApp();
    edit("changed");
    mocks.typstLivePreviewWanted.mockReturnValue(true);
    act(() => vi.advanceTimersByTime(2500));
    edit("again");
    act(() => vi.advanceTimersByTime(5000));
    expect(useCompileStore.getState().recompile).not.toHaveBeenCalled();
  });

  it("stays idle when automatic compile is off", async () => {
    useCompileStore.setState({ autoCompile: false });
    await renderApp();
    edit("changed");
    act(() => vi.advanceTimersByTime(5000));
    expect(useCompileStore.getState().recompile).not.toHaveBeenCalled();
  });
});
