// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tauri: false,
  nativeDockMenu: false,
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
  mountResearchPdfBridge: vi.fn(async () => () => {}),
  initAiPdfCaptureFlag: vi.fn(),
  previewRenders: 0,
  previewMounts: 0,
  previewUnmounts: 0,
  previewActive: null as boolean | null,
  editorRenders: 0,
  surfaceMounts: { editor: 0, sidebar: 0, chat: 0, terminal: 0 } as Record<string, number>,
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
    engine: { label: "Tectonic" },
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
  usesNativeDockMenu: () => mocks.nativeDockMenu,
}));
vi.mock("@/components/layout/CollabLiveKeeper", () => ({ CollabLiveKeeper: () => null }));
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
vi.mock("@/components/layout/CodeExecutionBanner", () => ({ CodeExecutionBanner: () => null }));
vi.mock("@/components/layout/TypstCjkFontBanner", () => ({ TypstCjkFontBanner: () => null }));
vi.mock("@/components/open-folder/OpenFolderKeeper", () => ({ OpenFolderKeeper: () => null }));
vi.mock("@/components/layout/ProjectAvailabilityKeeper", () => ({ ProjectAvailabilityKeeper: () => null }));
vi.mock("@/components/layout/FolderWatchKeeper", () => ({ FolderWatchKeeper: () => null }));
vi.mock("@/components/editor/Editor", async () => {
  const { useEffect } = await import("react");
  return {
    Editor: () => {
      mocks.editorRenders++;
      useEffect(() => {
        mocks.surfaceMounts.editor++;
      }, []);
      return <div data-testid="editor-surface" />;
    },
  };
});
vi.mock("@/components/preview/PreviewPane", async () => {
  const { useEffect } = await import("react");
  return {
    PreviewPane: ({ active = true }: { active?: boolean }) => {
      mocks.previewRenders++;
      mocks.previewActive = active;
      useEffect(() => {
        mocks.previewMounts++;
        return () => {
          mocks.previewUnmounts++;
        };
      }, []);
      return <div data-testid="preview-surface" />;
    },
  };
});
vi.mock("@/components/import/PdfImportView", () => ({ PdfImportView: () => <div data-testid="tool-pdf-import" /> }));
vi.mock("@/components/layout/Sidebar", async () => {
  const { useEffect } = await import("react");
  const { usePaneBar } = await import("@/components/layout/pane-reorder");
  return {
    Sidebar: () => {
      const bar = usePaneBar();
      useEffect(() => {
        mocks.surfaceMounts.sidebar++;
      }, []);
      return (
        <div id="files-panel" data-testid="sidebar-surface">
          <div {...bar} id="activity-bar" data-testid="sidebar-bar" />
        </div>
      );
    },
  };
});
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
vi.mock("@/components/dock/TerminalDock", async () => {
  const { useEffect } = await import("react");
  return {
    TerminalDock: () => {
      useEffect(() => {
        mocks.surfaceMounts.terminal++;
      }, []);
      return <div data-testid="terminal-dock" />;
    },
  };
});
vi.mock("@/lib/crash-report", () => ({ reportCrashToGithub: vi.fn(async () => {}) }));

import App from "./App";
import { useFilesStore } from "@/store/files";
import { useCompileStore } from "@/store/compile";
import { useHomeViewStore } from "@/store/home-view";
import { useTourStore } from "@/store/tours";
import { useSettingsStore } from "@/store/settings";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { enterZenMode, exitZenMode } from "@/lib/zen-mode";
import { togglePreviewPane } from "@/lib/compile-preview";
import {
  DEFAULT_PANE_LAYOUT,
  movePane,
  usePaneLayoutStore,
  type DropTarget,
  type PaneId,
} from "@/store/pane-layout";

const initialFiles = useFilesStore.getState();
const initialCompile = useCompileStore.getState();
const initialSettings = useSettingsStore.getState();

function savedLayout(layout: { viewMode?: string; showTree?: boolean; assistantOpen?: boolean; workspaceHidden?: boolean }) {
  localStorage.setItem("oleafly.workspace.p1", JSON.stringify({ version: 1, ...layout }));
}

async function renderApp() {
  const view = render(<App />);
  await act(async () => {});
  return view;
}

function move(pane: PaneId, target: DropTarget) {
  act(() => usePaneLayoutStore.getState().setLayout(movePane(usePaneLayoutStore.getState().layout, pane, target)));
}

function press(id: string, key: string) {
  const handle = document.getElementById(id);
  if (!handle) throw new Error(`${id} is not rendered`);
  act(() => handle.focus());
  fireEvent.keyDown(handle, { key });
}

beforeEach(() => {
  mocks.tauri = false;
  mocks.previewMounts = 0;
  mocks.previewUnmounts = 0;
  mocks.surfaceMounts = { editor: 0, sidebar: 0, chat: 0, terminal: 0 };
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
  mocks.nativeDockMenu = false;
  usePreviewDetachedStore.setState({ projectId: null });
  useSettingsStore.setState(
    {
      ...initialSettings,
      viewMode: "split",
      showTree: false,
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
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
});

afterEach(async () => {
  await vi.dynamicImportSettled();
  vi.restoreAllMocks();
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  document.documentElement.removeAttribute("style");
});

function flexOf(id: string): number {
  return Number(document.getElementById(id)?.style.flexGrow ?? Number.NaN);
}

function idsOf(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((element) => element.id);
}

function widePanels() {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") ? 1000 : this.hasAttribute("data-separator") ? 6 : 0;
  });
}

function openTerminal(open = true) {
  act(() => useSettingsStore.getState().setTerminalOpen(open));
}

const ALL_PANES: readonly PaneId[] = ["sidebar", "editor", "pdf", "terminal"];

function panesOnScreen(): PaneId[] {
  return ALL_PANES.filter((pane) => document.getElementById(pane) !== null);
}

function allSizes(): number[] {
  return ALL_PANES.map(flexOf);
}

describe.each([
  ["the default arrangement", null],
  ["a rearranged arrangement", ["terminal", { kind: "pane", pane: "pdf", side: "bottom" }] as const],
])("layout switches in %s", (_name, rearrange) => {
  async function resizedWorkspace() {
    widePanels();
    savedLayout({ showTree: true, });
    await renderApp();
    if (rearrange) move(rearrange[0], rearrange[1]);
    openTerminal();
    const before = allSizes();
    for (const id of idsOf("[data-separator]")) press(id, document.getElementById(id)?.getAttribute("aria-orientation") === "horizontal" ? "ArrowUp" : "ArrowRight");
    const sizes = allSizes();
    expect(sizes.every((size) => Number.isFinite(size) && size > 0)).toBe(true);
    expect(sizes).not.toEqual(before);
    return sizes;
  }

  it("brings the sizes back after Zen and the sidebar, preview and terminal toggles", async () => {
    const sizes = await resizedWorkspace();
    const toggles: [string, () => void, () => void][] = [
      ["zen", () => void enterZenMode(), () => exitZenMode()],
      ["sidebar", () => useSettingsStore.getState().setShowTree(false), () => useSettingsStore.getState().setShowTree(true)],
      ["preview", () => void togglePreviewPane(), () => void togglePreviewPane()],
      ["terminal", () => openTerminal(false), () => openTerminal()],
    ];
    for (const [name, off, on] of toggles) {
      act(off);
      expect(panesOnScreen(), name).not.toEqual(ALL_PANES);
      act(on);
      await waitFor(() => expect(allSizes(), name).toEqual(sizes));
    }
  });

  it("brings the sizes back when the project opens again", async () => {
    const sizes = await resizedWorkspace();
    act(() => useFilesStore.setState({ projectId: null }));
    act(() => useFilesStore.setState({ projectId: "p1" }));
    openTerminal();
    await waitFor(() => expect(allSizes()).toEqual(sizes));
  });
});
