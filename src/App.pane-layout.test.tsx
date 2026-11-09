// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("@/lib/mcp-bridge", () => ({ startMcpBridge: mocks.startMcpBridge }));
vi.mock("@/lib/research-pdf-bridge", () => ({ mountResearchPdfBridge: mocks.mountResearchPdfBridge }));
vi.mock("@/components/layout/CollabLiveKeeper", () => ({ CollabLiveKeeper: () => null }));
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
vi.mock("@/components/ai/ChatPanel", async () => {
  const { useEffect } = await import("react");
  const { usePaneBar } = await import("@/components/layout/pane-reorder");
  return {
    ChatPanel: () => {
      const bar = usePaneBar();
      useEffect(() => {
        mocks.surfaceMounts.chat++;
      }, []);
      return (
        <div data-panel="" id="chat-split" data-testid="chat-surface">
          <div {...bar} data-testid="ai-assistant-header" />
        </div>
      );
    },
  };
});
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
import { panelExpandSizesKey } from "@/lib/panel-layout";
import { DEFAULT_PANE_LAYOUT, movePane, usePaneLayoutStore, type DropTarget, type PaneId } from "@/store/pane-layout";

const initialFiles = useFilesStore.getState();
const initialCompile = useCompileStore.getState();
const initialSettings = useSettingsStore.getState();

type Shape = string | { [panel: string]: Shape[] };

const DEFAULT_SHAPE: Shape[] = [
  { "content-band": ["sidebar", "h-tree", { editorpdf: ["editor", "h-mid", "pdf"] }, "h-assistant", "assistant"] },
  "v-terminal",
  "terminal",
];

function savedLayout(layout: { viewMode?: string; showTree?: boolean; assistantOpen?: boolean; workspaceHidden?: boolean }) {
  localStorage.setItem("oleafly.workspace.p1", JSON.stringify({ version: 1, ...layout }));
}

async function renderApp() {
  const view = render(<App />);
  await act(async () => {});
  return view;
}

function rootGroup(): HTMLElement {
  const panel = document.querySelector<HTMLElement>("[data-panel]");
  const group = panel?.parentElement;
  if (!group) throw new Error("the workspace is not on screen");
  return group;
}

function shapeOf(group: HTMLElement): Shape[] {
  return [...group.children].map((child) => {
    const inner = child.querySelector<HTMLElement>(":scope > div > [data-group]");
    return inner ? { [child.id]: shapeOf(inner) } : child.id;
  });
}

function move(pane: PaneId, target: DropTarget) {
  act(() => usePaneLayoutStore.getState().setLayout(movePane(usePaneLayoutStore.getState().layout, pane, target)));
}

function inPanel(testId: string, panelId: string) {
  expect(screen.getByTestId(testId).closest(`[data-panel][id="${panelId}"]`)).not.toBeNull();
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

function rectOf(element: HTMLElement): DOMRect {
  if (element.hasAttribute("data-group")) {
    const holder = element.parentElement?.closest<HTMLElement>("[data-panel]");
    return holder ? rectOf(holder) : rect(0, 40, 1000, 600);
  }
  const group = element.parentElement;
  if (!element.hasAttribute("data-panel") || !group?.hasAttribute("data-group")) return rect(0, 0, 0, 0);
  const area = rectOf(group);
  const panels = [...group.children].filter((child) => child.hasAttribute("data-panel"));
  const index = panels.indexOf(element);
  if (group.style.flexDirection === "row") {
    const width = area.width / panels.length;
    return rect(area.left + index * width, area.top, width, area.height);
  }
  const height = area.height / panels.length;
  return rect(area.left, area.top + index * height, area.width, height);
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
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-panel") || this.hasAttribute("data-separator") ? 100 : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  document.documentElement.removeAttribute("style");
});

describe("default pane layout", () => {
  it("renders the same groups, panels and separators as the fixed layout", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    expect(shapeOf(rootGroup())).toEqual(DEFAULT_SHAPE);
    for (const group of document.querySelectorAll("[data-group]")) expect(group.id).not.toMatch(/^oleafly-panes/);
    expect(document.getElementById("sidebar")?.firstElementChild).toHaveClass("bg-sidebar");
    expect(document.getElementById("assistant")?.firstElementChild).toHaveClass("min-h-0", "min-w-0", "border-l");
    const terminalHandle = document.getElementById("v-terminal");
    expect(terminalHandle).toHaveClass("resize-handle-row", "invisible", "h-0");
    expect(terminalHandle).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById("h-tree")).toHaveClass("resize-handle-col");
    expect(document.getElementById("h-tree")).not.toHaveAttribute("aria-disabled");
    inPanel("sidebar-surface", "sidebar");
    inPanel("editor-surface", "editor");
    inPanel("preview-surface", "pdf");
    inPanel("chat-surface", "assistant");
    inPanel("terminal-dock", "terminal");
  });

  it("keeps the sidebar separator when the document is hidden and opens the terminal separator", async () => {
    savedLayout({ showTree: true, assistantOpen: true, workspaceHidden: true });
    await renderApp();
    expect(shapeOf(rootGroup())).toEqual([
      { "content-band": ["sidebar", "h-tree", "assistant"] },
      "v-terminal",
      "terminal",
    ]);
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    expect(document.getElementById("v-terminal")).not.toHaveClass("invisible");
    expect(document.getElementById("v-terminal")).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("moved pane layout", () => {
  it("nests groups for a stacked pane and names them after their panes", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    expect(shapeOf(rootGroup())).toEqual([
      "sidebar",
      "sep-panes-editor-pdf-terminal-sidebar",
      {
        "panes-editor-pdf-terminal": [
          "editor",
          "sep-editor-panes-pdf-terminal",
          { "panes-pdf-terminal": ["pdf", "sep-pdf-terminal", "terminal"] },
        ],
      },
      "sep-assistant-panes-editor-pdf-terminal",
      "assistant",
    ]);
    expect(document.getElementById("sep-pdf-terminal")).toHaveClass("resize-handle-row", "invisible");
    expect(document.getElementById("sep-editor-panes-pdf-terminal")).toHaveClass("resize-handle-col");
    inPanel("terminal-dock", "terminal");
    inPanel("terminal-dock", "panes-pdf-terminal");
  });

  it("puts a pane along a window edge", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    move("terminal", { kind: "edge", side: "top" });
    expect(shapeOf(rootGroup())).toEqual(["terminal", "v-terminal", ...DEFAULT_SHAPE.slice(0, 1)]);
    expect(rootGroup().id).toBe("oleafly-panes-vertical-terminal-content-band");
    move("assistant", { kind: "edge", side: "left" });
    expect(shapeOf(rootGroup())).toEqual([
      "assistant",
      "sep-assistant-panes-editor-pdf-sidebar-terminal",
      {
        "panes-editor-pdf-sidebar-terminal": [
          "terminal",
          "sep-panes-editor-pdf-sidebar-terminal",
          { "panes-editor-pdf-sidebar": ["sidebar", "sep-editorpdf-sidebar".replace("sep-editorpdf-sidebar", "h-tree"), { editorpdf: ["editor", "h-mid", "pdf"] }] },
        ],
      },
    ]);
    expect(document.getElementById("assistant")?.firstElementChild).toHaveClass("border-r");
  });

  it("moves every pane without remounting what is inside it", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    const mounts = { ...mocks.surfaceMounts };
    expect(mounts).toEqual({ editor: 1, sidebar: 1, chat: 1, terminal: 1 });
    expect(mocks.previewMounts).toBe(1);
    const moves: [PaneId, DropTarget][] = [
      ["terminal", { kind: "pane", pane: "pdf", side: "bottom" }],
      ["sidebar", { kind: "edge", side: "right" }],
      ["editor", { kind: "pane", pane: "assistant", side: "top" }],
      ["pdf", { kind: "pane", pane: "sidebar", side: "left" }],
      ["assistant", { kind: "edge", side: "bottom" }],
    ];
    for (const [pane, target] of moves) {
      move(pane, target);
      expect(mocks.surfaceMounts).toEqual(mounts);
      inPanel("sidebar-surface", "sidebar");
      inPanel("editor-surface", "editor");
      inPanel("preview-surface", "pdf");
      inPanel("chat-surface", "assistant");
      inPanel("terminal-dock", "terminal");
    }
    act(() => usePaneLayoutStore.getState().reset());
    expect(shapeOf(rootGroup())).toEqual(DEFAULT_SHAPE);
    expect(mocks.surfaceMounts).toEqual(mounts);
    expect(mocks.previewMounts).toBe(1);
    expect(mocks.previewUnmounts).toBe(0);
  });

  it("shows and hides panes wherever they sit and closes the space they leave", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    move("assistant", { kind: "pane", pane: "terminal", side: "right" });
    move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    expect(document.getElementById("panes-pdf-terminal")).not.toBeNull();

    act(() => useSettingsStore.getState().setViewMode("editor"));
    expect(document.getElementById("pdf")).toBeNull();
    expect(document.getElementById("panes-pdf-terminal")).toBeNull();
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    expect(document.getElementById("panes-pdf-terminal")).not.toBeNull();
    inPanel("terminal-dock", "terminal");

    act(() => useSettingsStore.getState().setAssistantOpen(false));
    expect(document.getElementById("assistant")).toBeNull();
    act(() => useSettingsStore.getState().setShowTree(false));
    expect(document.getElementById("sidebar")).toBeNull();

    act(() => useSettingsStore.setState({ assistantOpen: true, workspaceHidden: true, showTree: true }));
    expect(document.getElementById("editor")).toBeNull();
    expect(document.getElementById("pdf")).toBeNull();
    expect(document.getElementById("assistant")).not.toBeNull();

    act(() => useSettingsStore.setState({ workspaceHidden: false, viewMode: "split" }));
    act(() => usePreviewDetachedStore.setState({ projectId: "p1" }));
    expect(document.getElementById("pdf")).toBeNull();
    expect(document.getElementById("editor")).not.toBeNull();
  });

  it("closes the assistant when its separator is pushed to the edge of a stack", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    move("assistant", { kind: "pane", pane: "pdf", side: "bottom" });
    expect(document.getElementById("sep-assistant-pdf")).not.toBeNull();
    for (let step = 0; step < 10 && useSettingsStore.getState().assistantOpen; step += 1) press("sep-assistant-pdf", "ArrowDown");
    expect(useSettingsStore.getState().assistantOpen).toBe(false);
  });

  it("follows the terminal wherever it sits when it opens, closes or is pushed shut", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    });
    expect(document.getElementById("sep-pdf-terminal")).not.toHaveClass("invisible");
    for (let step = 0; step < 10 && useSettingsStore.getState().terminalOpen; step += 1) press("sep-pdf-terminal", "ArrowDown");
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    act(() => useSettingsStore.getState().setTerminalOpen(false));
    await act(async () => {
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)));
    });
    expect(localStorage.getItem(panelExpandSizesKey("oleafly.workspace.p1.split-pdf-terminal"))).toContain("terminal");
  });

  it("moves a pane dropped on another pane's edge or on the window edge", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rectOf(this);
    });
    fireEvent.pointerDown(screen.getByTestId("sidebar-bar"), { button: 0, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 950, clientY: 150, buttons: 1 });
    expect(document.querySelector("[data-pane-drop]")).toHaveAttribute("data-pane-drop", "assistant-right");
    fireEvent.pointerUp(window);
    expect(shapeOf(rootGroup())[0]).toEqual({
      "content-band": [{ editorpdf: ["editor", "h-mid", "pdf"] }, "h-assistant", "assistant", "h-side-assistant", "sidebar"],
    });

    fireEvent.pointerDown(screen.getByTestId("ai-assistant-header"), { button: 0, clientX: 600, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 632, buttons: 1 });
    expect(document.querySelector("[data-pane-drop]")).toHaveAttribute("data-pane-drop", "edge-bottom");
    fireEvent.pointerUp(window);
    expect(shapeOf(rootGroup()).map((entry) => (typeof entry === "string" ? entry : Object.keys(entry)[0]))).toEqual([
      "panes-editor-pdf-sidebar",
      "sep-panes-editor-pdf-sidebar-terminal",
      "terminal",
      "sep-assistant-terminal",
      "assistant",
    ]);
  });
});
