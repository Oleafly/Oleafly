// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    isFullscreen: async () => false,
    setFullscreen: async () => {},
    onResized: async () => () => {},
  }),
}));

vi.mock("@/store/files", async () => {
  const { create } = await import("zustand");
  const useFilesStore = create(() => ({
    projectId: "p1" as string | null,
    projectName: "Paper",
    engine: { label: "Tectonic" },
    manifestHome: "app",
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
import { useShortcutStore } from "@/store/shortcuts";
import { useZenStore } from "@/store/zen";
import { enterZenMode, exitZenMode } from "@/lib/zen-mode";

const initialFiles = useFilesStore.getState();
const initialCompile = useCompileStore.getState();
const initialSettings = useSettingsStore.getState();

function keydown(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

async function renderApp(
  saved: { viewMode?: string; showTree?: boolean; assistantOpen?: boolean } = {},
  after: Partial<ReturnType<typeof useSettingsStore.getState>> = {},
) {
  localStorage.setItem(
    "oleafly.workspace.p1",
    JSON.stringify({ version: 1, viewMode: "split", showTree: true, assistantOpen: true, ...saved }),
  );
  const view = render(<App />);
  await act(async () => {});
  act(() => useSettingsStore.setState({ railTab: "source", ...after }));
  return view;
}

function zenOn() {
  act(() => {
    enterZenMode();
  });
}

function root() {
  return document.querySelector("[data-sidebar-open]") as HTMLElement;
}

function layout() {
  const s = useSettingsStore.getState();
  return {
    showTree: s.showTree,
    assistantOpen: s.assistantOpen,
    terminalOpen: s.terminalOpen,
    viewMode: s.viewMode,
    railTab: s.railTab,
  };
}

beforeEach(() => {
  mocks.tauri = false;
  mocks.listeners.clear();
  vi.clearAllMocks();
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
  useShortcutStore.getState().resetAll();
  useZenStore.getState().end();
  useSettingsStore.setState(
    {
      ...initialSettings,
      viewMode: "split",
      showTree: true,
      railTab: "source",
      chatFloating: false,
      assistantOpen: true,
      workspaceHidden: false,
      terminalOpen: false,
      vim: false,
      zenFullScreen: false,
      zenShowPdfOnCompile: true,
      defaultView: "editor-preview",
      openInTree: true,
      appFontFamily: "",
      editorFontFamily: "",
    },
    true,
  );
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("style");
});

describe("entering Zen mode", () => {
  it("hides the toolbar, sidebar, assistant and floating copilot and keeps the editor and PDF", async () => {
    useSettingsStore.setState({ chatFloating: true });
    await renderApp();
    expect(screen.getByTestId("sidebar-surface")).toBeInTheDocument();
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("top-toolbar").closest("[hidden]")).toBeNull();

    zenOn();

    expect(screen.getByTestId("top-toolbar").closest("[hidden]")).not.toBeNull();
    expect(screen.queryByTestId("sidebar-surface")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-surface")).not.toBeInTheDocument();
    expect(screen.queryByTestId("copilot-overlay")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-surface")).toBeInTheDocument();
    expect(screen.getByTestId("preview-surface")).toBeInTheDocument();
    expect(root()).toHaveAttribute("data-zen", "true");
    expect(await screen.findByTestId("zen-title-strip")).toBeInTheDocument();
    expect(screen.getByTestId("zen-compile-corner")).toBeInTheDocument();
  });

  it("brings everything back, exactly as it was, when it ends", async () => {
    useSettingsStore.setState({ chatFloating: true });
    await renderApp({}, { terminalOpen: true });
    const before = layout();

    zenOn();
    act(() => exitZenMode());

    expect(layout()).toEqual(before);
    expect(screen.getByTestId("top-toolbar").closest("[hidden]")).toBeNull();
    expect(screen.getByTestId("sidebar-surface")).toBeInTheDocument();
    expect(screen.getByTestId("chat-surface")).toBeInTheDocument();
    expect(screen.getByTestId("copilot-overlay")).toBeInTheDocument();
    expect(screen.queryByTestId("zen-title-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("zen-compile-corner")).not.toBeInTheDocument();
    expect(root()).not.toHaveAttribute("data-zen");
  });

  it("keeps only the editor when the PDF was not showing", async () => {
    await renderApp({ viewMode: "editor" });
    zenOn();
    expect(screen.getByTestId("editor-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-surface")).not.toBeInTheDocument();
  });

  it("does not save the Zen layout, so a restart never starts in Zen", async () => {
    await renderApp();
    const saved = localStorage.getItem("oleafly.workspace.p1");
    expect(saved).not.toBeNull();
    zenOn();
    expect(localStorage.getItem("oleafly.workspace.p1")).toBe(saved);
    act(() => exitZenMode());
    expect(localStorage.getItem("oleafly.workspace.p1")).toBe(saved);
  });

  it("does not start Zen mode on the library page", async () => {
    useFilesStore.setState({ projectId: null });
    await renderApp();
    zenOn();
    expect(useZenStore.getState().active).toBe(false);
    expect(screen.getByTestId("library")).toBeInTheDocument();
  });

  it("ends when the project closes", async () => {
    await renderApp();
    zenOn();
    act(() => useFilesStore.setState({ projectId: null }));
    expect(useZenStore.getState().active).toBe(false);
    expect(screen.getByTestId("library")).toBeInTheDocument();
  });

  it("ends when another project opens, keeping that project's own layout", async () => {
    await renderApp();
    zenOn();
    localStorage.setItem("oleafly.workspace.p2", JSON.stringify({ version: 1, viewMode: "editor", showTree: false, assistantOpen: false }));
    act(() => useFilesStore.setState({ projectId: "p2" }));
    expect(useZenStore.getState().active).toBe(false);
    expect(layout()).toMatchObject({ viewMode: "editor", showTree: false, assistantOpen: false });
  });
});

describe("the Zen shortcut", () => {
  it("turns Zen mode on and off with Shift+F11", async () => {
    await renderApp();
    const before = layout();
    keydown(document.body, { key: "F11", shiftKey: true });
    expect(useZenStore.getState().active).toBe(true);
    expect(screen.queryByTestId("sidebar-surface")).not.toBeInTheDocument();
    keydown(document.body, { key: "F11", shiftKey: true });
    expect(useZenStore.getState().active).toBe(false);
    expect(layout()).toEqual(before);
  });

  it("follows a rebound shortcut", async () => {
    await renderApp();
    act(() => useShortcutStore.getState().setBinding("toggleZenMode", { key: "z", ctrl: true, alt: true }));
    keydown(document.body, { key: "F11", shiftKey: true });
    expect(useZenStore.getState().active).toBe(false);
    keydown(document.body, { key: "z", ctrlKey: true, altKey: true });
    expect(useZenStore.getState().active).toBe(true);
  });

  it("does not start in the middle of a tour", async () => {
    await renderApp();
    act(() => useTourStore.setState({ activeTourId: "workspace" }));
    keydown(document.body, { key: "F11", shiftKey: true });
    expect(useZenStore.getState().active).toBe(false);
  });
});

describe("panels inside Zen mode", () => {
  beforeEach(async () => {
    await renderApp();
    zenOn();
  });

  it("brings the sidebar back and away with the sidebar shortcut", () => {
    keydown(document.body, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("sidebar-surface")).toBeInTheDocument();
    keydown(document.body, { key: "b", ctrlKey: true });
    expect(screen.queryByTestId("sidebar-surface")).not.toBeInTheDocument();
  });

  it("brings the terminal back and away with the terminal shortcut", () => {
    keydown(document.body, { key: "`", ctrlKey: true });
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
    keydown(document.body, { key: "`", ctrlKey: true });
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
  });

  it("leaves a panel brought back to the layout it had before when Zen ends", () => {
    keydown(document.body, { key: "b", ctrlKey: true });
    keydown(document.body, { key: "`", ctrlKey: true });
    act(() => exitZenMode());
    expect(layout()).toMatchObject({ showTree: true, terminalOpen: false, assistantOpen: true, railTab: "source" });
  });

  it("keeps the toolbar hidden while a panel is back", () => {
    keydown(document.body, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("top-toolbar").closest("[hidden]")).not.toBeNull();
  });
});

describe("leaving with Escape twice", () => {
  beforeEach(async () => {
    await renderApp();
    zenOn();
  });

  it("leaves on two quick presses", () => {
    keydown(document.body, { key: "Escape" });
    expect(useZenStore.getState().active).toBe(true);
    vi.advanceTimersByTime(200);
    keydown(document.body, { key: "Escape" });
    expect(useZenStore.getState().active).toBe(false);
  });

  it("stays on after one press, or two far apart", () => {
    keydown(document.body, { key: "Escape" });
    vi.advanceTimersByTime(800);
    keydown(document.body, { key: "Escape" });
    expect(useZenStore.getState().active).toBe(true);
  });

  it("does not count an Escape a dialog used", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    keydown(document.body, { key: "Escape" });
    keydown(document.body, { key: "Escape" });
    expect(useZenStore.getState().active).toBe(true);
    dialog.remove();
  });
});

describe("the PDF pane when you compile", () => {
  beforeEach(async () => {
    await renderApp({ viewMode: "editor" });
    zenOn();
  });

  it("opens beside the editor when the recompile shortcut is used", () => {
    expect(screen.queryByTestId("preview-surface")).not.toBeInTheDocument();
    keydown(document.body, { key: "Enter", ctrlKey: true });
    expect(screen.getByTestId("preview-surface")).toBeInTheDocument();
    expect(screen.getByTestId("editor-surface")).toBeInTheDocument();
  });

  it("stays closed when a compile starts on its own", () => {
    act(() => useCompileStore.setState({ status: "compiling" }));
    expect(screen.queryByTestId("preview-surface")).not.toBeInTheDocument();
  });

  it("leaves the editor alone when Show the PDF when you compile is off", () => {
    act(() => {
      exitZenMode();
      useSettingsStore.setState({ zenShowPdfOnCompile: false, viewMode: "editor" });
      enterZenMode();
    });
    keydown(document.body, { key: "Enter", ctrlKey: true });
    act(() => useCompileStore.setState({ status: "compiling" }));
    expect(screen.queryByTestId("preview-surface")).not.toBeInTheDocument();
  });

  it("is editor-alone again after Zen ends", () => {
    keydown(document.body, { key: "Enter", ctrlKey: true });
    expect(screen.getByTestId("preview-surface")).toBeInTheDocument();
    act(() => exitZenMode());
    expect(screen.queryByTestId("preview-surface")).not.toBeInTheDocument();
    expect(useSettingsStore.getState().viewMode).toBe("editor");
  });
});

