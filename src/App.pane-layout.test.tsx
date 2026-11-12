// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { enterZenMode, exitZenMode } from "@/lib/zen-mode";
import { togglePreviewPane } from "@/lib/compile-preview";
import type { LayoutPreset } from "@/store/settings";
import {
  DEFAULT_PANE_LAYOUT,
  movePane,
  panelIdOf,
  splitsOf,
  usePaneLayoutStore,
  type DropTarget,
  type PaneId,
} from "@/store/pane-layout";

const initialFiles = useFilesStore.getState();
const initialCompile = useCompileStore.getState();
const initialSettings = useSettingsStore.getState();

type Shape = string | { [panel: string]: Shape[] };

const BAND: Shape = {
  "content-band": ["sidebar", "h-tree", { editorpdf: ["editor", "h-mid", "pdf"] }, "h-assistant", "assistant"],
};
const DEFAULT_SHAPE: Shape[] = [BAND, "v-terminal", "terminal"];

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

const RELEASED_KEYS = {
  vertical: "react-resizable-panels:oleafly.workspace.p1.vertical:content-band:terminal",
  horizontal: "react-resizable-panels:oleafly.workspace.p1.horizontal:sidebar:editorpdf:assistant",
  aiOnly: "react-resizable-panels:oleafly.workspace.p1.horizontal:sidebar:assistant",
  document: "react-resizable-panels:oleafly.workspace.p1.document:editor:pdf",
};

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

describe("released storage keys, panel ids and separator ids", () => {
  it("reads the sizes the released app saved and writes them back under the same keys", async () => {
    widePanels();
    savedLayout({ showTree: true, assistantOpen: true });
    localStorage.setItem(RELEASED_KEYS.horizontal, JSON.stringify({ sidebar: 30, editorpdf: 45, assistant: 25 }));
    localStorage.setItem(RELEASED_KEYS.document, JSON.stringify({ editor: 60, pdf: 40 }));
    localStorage.setItem(RELEASED_KEYS.vertical, JSON.stringify({ "content-band": 65, terminal: 35 }));
    await renderApp();
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    await waitFor(() => expect(flexOf("terminal")).toBe(35));
    expect(idsOf("[data-panel]").filter((id) => id !== "chat-split")).toEqual([
      "content-band",
      "sidebar",
      "editorpdf",
      "editor",
      "pdf",
      "assistant",
      "terminal",
    ]);
    expect(idsOf("[data-separator]")).toEqual(["h-tree", "h-mid", "h-assistant", "v-terminal"]);
    for (const group of document.querySelectorAll("[data-group]")) expect(group.id).toMatch(/^:r|^$|^«|^_r/);
    expect([flexOf("sidebar"), flexOf("editorpdf"), flexOf("assistant")]).toEqual([30, 45, 25]);
    expect([flexOf("editor"), flexOf("pdf")]).toEqual([60, 40]);
    expect([flexOf("content-band"), flexOf("terminal")]).toEqual([65, 35]);
    press("h-mid", "ArrowRight");
    expect(JSON.parse(localStorage.getItem(RELEASED_KEYS.document) ?? "null")).toEqual({ editor: 70, pdf: 30 });
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("react-resizable-panels:"));
    expect(keys).toEqual(expect.arrayContaining([RELEASED_KEYS.document, RELEASED_KEYS.horizontal, RELEASED_KEYS.vertical]));
    for (const key of keys) {
      expect(key).toMatch(/^react-resizable-panels:oleafly\.workspace\.p1\.(vertical|horizontal|document):[a-z-]+(:[a-z-]+)*$/);
    }
  });

  it("opens a terminal the released app saved closed at its remembered height", async () => {
    widePanels();
    savedLayout({ showTree: true, assistantOpen: true });
    localStorage.setItem(RELEASED_KEYS.vertical, JSON.stringify({ "content-band": 100, terminal: 0 }));
    localStorage.setItem("oleafly.panel-expand-sizes.oleafly.workspace.p1.vertical", JSON.stringify({ terminal: 35 }));
    await renderApp();
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
    act(() => useSettingsStore.getState().setTerminalOpen(true));
    await waitFor(() => expect([flexOf("content-band"), flexOf("terminal")]).toEqual([65, 35]));
    expect(useSettingsStore.getState().terminalOpen).toBe(true);
  });

  it("names the separator between the sidebar and the assistant h-tree in AI only", async () => {
    widePanels();
    savedLayout({ showTree: true, assistantOpen: true, workspaceHidden: true });
    localStorage.setItem(RELEASED_KEYS.aiOnly, JSON.stringify({ sidebar: 35, assistant: 65 }));
    await renderApp();
    expect(idsOf("[data-separator]").filter((id) => id !== "v-terminal")).toEqual(["h-tree"]);
    expect([flexOf("sidebar"), flexOf("assistant")]).toEqual([35, 65]);
  });
});

function splitOf(pane: PaneId): string {
  const parent = splitsOf(usePaneLayoutStore.getState().layout).find((node) =>
    node.children.some((child) => "pane" in child && child.pane === pane),
  );
  if (!parent) throw new Error(`${pane} has no parent split`);
  return panelIdOf(parent);
}

function openTerminal(open = true) {
  act(() => useSettingsStore.getState().setTerminalOpen(open));
}

function sizes(...ids: string[]): number[] {
  return ids.map(flexOf);
}

describe("default pane layout", () => {
  it("renders the released panels and adds the terminal only while it is open", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    expect(shapeOf(rootGroup())).toEqual([BAND]);
    inPanel("sidebar-surface", "sidebar");
    inPanel("editor-surface", "editor");
    inPanel("preview-surface", "pdf");
    inPanel("chat-surface", "assistant");
    expect(document.getElementById("terminal")).toBeNull();
    openTerminal();
    expect(shapeOf(rootGroup())).toEqual(DEFAULT_SHAPE);
    inPanel("terminal-dock", "terminal");
    openTerminal(false);
    expect(shapeOf(rootGroup())).toEqual([BAND]);
    openTerminal();
    expect(mocks.surfaceMounts.terminal).toBe(1);
  });

  it("keeps the sidebar separator when the document is hidden", async () => {
    savedLayout({ showTree: true, assistantOpen: true, workspaceHidden: true });
    await renderApp();
    expect(shapeOf(rootGroup())).toEqual([{ "content-band": ["sidebar", "h-tree", "assistant"] }]);
    openTerminal();
    expect(shapeOf(rootGroup())).toEqual([{ "content-band": ["sidebar", "h-tree", "assistant"] }, "v-terminal", "terminal"]);
  });
});

describe("moved pane layout", () => {
  it("nests a stacked pane in a group with a short id", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    openTerminal();
    move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    expect(shapeOf(rootGroup())).toEqual([
      "sidebar",
      "h-tree",
      { editorpdf: ["editor", "sep-editor-s1", { s1: ["pdf", "sep-pdf-terminal", "terminal"] }] },
      "h-assistant",
      "assistant",
    ]);
    inPanel("terminal-dock", "s1");
  });

  it("puts a pane along a window edge", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    openTerminal();
    move("terminal", { kind: "edge", side: "top" });
    expect(shapeOf(rootGroup())).toEqual(["terminal", "v-terminal", BAND]);
    move("assistant", { kind: "edge", side: "left" });
    expect(shapeOf(rootGroup())).toEqual([
      "assistant",
      "sep-assistant-s1",
      { s1: ["terminal", "v-terminal", { "content-band": ["sidebar", "h-tree", { editorpdf: ["editor", "h-mid", "pdf"] }] }] },
    ]);
  });

  it("moves every pane without remounting what is inside it", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    openTerminal();
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
    const stack = splitOf("terminal");
    expect(document.getElementById(stack)).not.toBeNull();
    expect(document.getElementById("terminal")).toBeNull();

    act(() => useSettingsStore.getState().setViewMode("editor"));
    expect(document.getElementById("pdf")).toBeNull();
    expect(document.getElementById(stack)).toBeNull();
    openTerminal();
    expect(document.getElementById(stack)).not.toBeNull();
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
    expect(document.getElementById("sep-pdf-assistant")).not.toBeNull();
    for (let step = 0; step < 10 && useSettingsStore.getState().assistantOpen; step += 1) press("sep-pdf-assistant", "ArrowDown");
    expect(useSettingsStore.getState().assistantOpen).toBe(false);
  });

  it("reopens the terminal at the height it had and closes it when it is pushed shut", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    openTerminal();
    press("sep-pdf-terminal", "ArrowUp");
    const open = sizes("pdf", "terminal");
    openTerminal(false);
    expect(document.getElementById("terminal")).toBeNull();
    openTerminal();
    await waitFor(() => expect(sizes("pdf", "terminal")).toEqual(open));
    for (let step = 0; step < 10 && useSettingsStore.getState().terminalOpen; step += 1) press("sep-pdf-terminal", "ArrowDown");
    expect(useSettingsStore.getState().terminalOpen).toBe(false);
    expect(document.getElementById("terminal")).toBeNull();
  });

  it("keeps a resizable separator for a pane moved below the closed terminal", async () => {
    widePanels();
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    act(() => usePaneLayoutStore.getState().move("assistant", { kind: "edge", side: "bottom" }));
    const separators = idsOf("[data-separator]");
    const between = separators[separators.length - 1] ?? "";
    expect(shapeOf(rootGroup()).map((entry) => (typeof entry === "string" ? entry : Object.keys(entry)[0]))).toEqual([
      "content-band",
      between,
      "assistant",
    ]);
    expect(document.getElementById(between)).not.toHaveAttribute("aria-disabled", "true");
    const before = flexOf("assistant");
    press(between, "ArrowUp");
    expect(flexOf("assistant")).toBeGreaterThan(before);
  });

  it.each([true, false])("leaves the terminal %s when the arrangement is reset", async (open) => {
    savedLayout({ showTree: true, assistantOpen: true });
    localStorage.setItem(
      RELEASED_KEYS.vertical,
      JSON.stringify(open ? { "content-band": 100, terminal: 0 } : { "content-band": 72, terminal: 28 }),
    );
    await renderApp();
    openTerminal(open);
    move("sidebar", { kind: "edge", side: "right" });
    act(() => usePaneLayoutStore.getState().reset());
    await act(async () => {});
    expect(useSettingsStore.getState().terminalOpen).toBe(open);
    expect(document.getElementById("terminal") !== null).toBe(open);
  });

  it("keeps the sizes the user set when a pane moves away and back", async () => {
    widePanels();
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    openTerminal();
    press("h-tree", "ArrowRight");
    press("h-mid", "ArrowRight");
    press("v-terminal", "ArrowUp");
    const band = sizes("sidebar", "editorpdf", "assistant");
    const documentSizes = sizes("editor", "pdf");
    const terminal = sizes("content-band", "terminal");
    act(() => usePaneLayoutStore.getState().move("terminal", { kind: "pane", pane: "pdf", side: "bottom" }));
    expect(sizes("sidebar", "editorpdf", "assistant")).toEqual(band);
    expect(sizes("editor", splitOf("terminal"))).toEqual(documentSizes);
    act(() => usePaneLayoutStore.getState().move("terminal", { kind: "edge", side: "bottom" }));
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
    expect(sizes("sidebar", "editorpdf", "assistant")).toEqual(band);
    expect(sizes("editor", "pdf")).toEqual(documentSizes);
    expect(sizes("content-band", "terminal")).toEqual(terminal);
  });

  it("moves a pane dropped on another pane's edge or on the window edge", async () => {
    savedLayout({ showTree: true, assistantOpen: true });
    await renderApp();
    openTerminal();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return rectOf(this);
    });
    fireEvent.pointerDown(screen.getByTestId("sidebar-bar"), { button: 0, clientX: 100, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 950, clientY: 150, buttons: 1 });
    expect(document.querySelector("[data-pane-drop]")).toHaveAttribute("data-pane-drop", "assistant-right");
    fireEvent.pointerUp(window);
    expect(shapeOf(rootGroup())[0]).toEqual({
      "content-band": [{ editorpdf: ["editor", "h-mid", "pdf"] }, "h-assistant", "assistant", "sep-assistant-sidebar", "sidebar"],
    });

    fireEvent.pointerDown(screen.getByTestId("ai-assistant-header"), { button: 0, clientX: 600, clientY: 60 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 632, buttons: 1 });
    expect(document.querySelector("[data-pane-drop]")).toHaveAttribute("data-pane-drop", "edge-bottom");
    fireEvent.pointerUp(window);
    expect(shapeOf(rootGroup()).map((entry) => (typeof entry === "string" ? entry : Object.keys(entry)[0]))).toEqual([
      "content-band",
      "v-terminal",
      "terminal",
      "sep-terminal-assistant",
      "assistant",
    ]);
  });
});

const PRESETS: readonly [LayoutPreset, readonly PaneId[]][] = [
  ["editor-preview-ai", ["editor", "pdf", "assistant"]],
  ["editor-preview", ["editor", "pdf"]],
  ["editor-ai", ["editor", "assistant"]],
  ["preview-ai", ["pdf", "assistant"]],
  ["editor-only", ["editor"]],
  ["preview-only", ["pdf"]],
  ["ai-only", ["assistant"]],
];
const ALL_PANES: readonly PaneId[] = ["sidebar", "editor", "pdf", "terminal", "assistant"];

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
    savedLayout({ showTree: true, assistantOpen: true });
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

  it("shows the panes of each preset and brings the sizes back", async () => {
    const sizes = await resizedWorkspace();
    for (const [preset, panes] of PRESETS) {
      act(() => useSettingsStore.getState().setLayoutPreset(preset));
      expect(panesOnScreen()).toEqual(ALL_PANES.filter((pane) => pane === "sidebar" || pane === "terminal" || panes.includes(pane)));
    }
    act(() => useSettingsStore.getState().setLayoutPreset("editor-preview-ai"));
    await waitFor(() => expect(allSizes()).toEqual(sizes));
  });

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
