import { startPreviewWorkspaceBridge } from "@/lib/preview-workspace";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { restoreWorkspaceLayout, workspacePanelId } from "@/lib/workspace-layout";
import { useTranslation } from "react-i18next";
import { CiteOleaflyDialog } from "@/components/layout/CiteOleaflyDialog";
import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Group,
  Panel,
  Separator,
  type GroupImperativeHandle,
  type Layout,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { ThemeProvider, applyAccentColor, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { BackendProtocolBanner } from "@/components/layout/BackendProtocolBanner";
import { FolderUnavailableBanner } from "@/components/layout/FolderUnavailableBanner";
import { MainDocumentPicker } from "@/components/open-folder/MainDocumentPicker";
import { OpenedFolderBanners } from "@/components/open-folder/OpenedFolderBanners";
import { ShellCommandsBanner } from "@/components/layout/ShellCommandsBanner";
import { ZenSession } from "@/components/layout/ZenSession";
import { ZenCompileCorner, ZenTitleStrip } from "@/components/layout/ZenChrome";
import { OpenFolderKeeper } from "@/components/open-folder/OpenFolderKeeper";
import { ProjectAvailabilityKeeper } from "@/components/layout/ProjectAvailabilityKeeper";
import { FolderWatchKeeper } from "@/components/layout/FolderWatchKeeper";
import { Editor } from "@/components/editor/Editor";
import {
  editorUndo,
  editorRedo,
  editorVimUndo,
  editorVimRedo,
  getEditorView,
} from "@/components/editor/cm/controller";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { KeptAliveSlot, useKeptAliveHost } from "@/components/layout/KeptAliveSlot";
import { PdfImportView } from "@/components/import/PdfImportView";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchOmnibar } from "@/components/layout/SearchOmnibar";
import { GlobalNewProject } from "@/components/library/GlobalNewProject";
import { CopyIntoLibraryDialog } from "@/components/library/CopyIntoLibraryDialog";
import { BibtexToolView } from "@/components/tools/BibtexToolView";
import { TableToolView } from "@/components/tools/TableToolView";
import { DeadlinesView } from "@/components/deadlines/DeadlinesView";
import { LatexToolsView } from "@/components/tools/LatexToolsView";
import { LabSearchToolView } from "@/components/tools/LabSearchToolView";
import { useHomeViewStore } from "@/store/home-view";
import {
  LanguageServiceRuntimeBoundary,
  LanguageServiceRuntimeUnavailable,
} from "@/components/editor/LanguageServiceRuntimeBoundary";
import { Library } from "@/components/library/Library";
import { bootSplashHeld, dismissBootSplash, markBootStage } from "@/lib/boot-telemetry";
import { useFilesStore, useActiveContent } from "@/store/files";
import {
  isCompileCheckpointCurrent,
  stopOutdatedAutomaticCompile,
  typstLivePreviewWanted,
  useCompileStore,
} from "@/store/compile";
import { useProjectAnalysisStore } from "@/store/project-analysis";
import { usePreflightStore } from "@/store/preflight";
import { editorLineHeightValue, useSettingsStore, type ViewMode } from "@/store/settings";
import { fontFamilyName, fontFamilyStack } from "@/lib/font-families";
import { applyAppTypography } from "@/lib/app-typography";
import { registerBrowserCuaSurface } from "@/lib/browser-window";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { useZenStore } from "@/store/zen";
import { exitZenMode } from "@/lib/zen-mode";
import {
  automaticCompileAllowed,
  openCompileHydrated,
  type OpenCompileRetries,
  resetOpenCompileMarker,
  settleOpenCompile,
  shouldCompileOnOpen,
} from "@/lib/open-compile";
import { useGitStatusStore } from "@/store/git-status";
import { useGithubStore } from "@/store/github";
import { forwardFromCursor } from "@/features/synctex";
import { checkForUpdatesOnStartup, openUpdateWindow } from "@/lib/updater";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriEvent, useTauriSubscription } from "@/hooks/use-tauri-event";
import { cn } from "@/lib/utils";
import {
  PANEL_STYLE,
  afterPanelLayout,
  collapsePanel,
  expandPanel,
  hasStoredPanelLayout,
  panelLimitProps,
  percent,
  useCollapseTransitions,
  useDismissiblePanelLayout,
  usePersistentPanelLayout,
  useSeparatorHitArea,
  useSeparatorKeyboard,
  useSteadyPanelWidth,
  type PanelLimits,
} from "@/lib/panel-layout";
import { AssistantOutputsBridge } from "@/components/ai/AssistantOutputsBridge";
import { ExternalToolApprovals } from "@/components/ai/ExternalToolApprovals";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { AboutModal } from "@/components/layout/AboutModal";
import { EnginePickerModal } from "@/components/layout/EnginePickerModal";
import { expectEngineChoiceOnOpen, takeEngineChoiceOnOpen } from "@/store/engine-picker";
import { revealPreviewForCompile } from "@/lib/compile-preview";
import { TinytexGuards } from "@/components/layout/TinytexGuards";
import { QuitGuard } from "@/components/layout/QuitGuard";
import { SaveBlockedDialog } from "@/components/layout/SaveBlockedDialog";
import { OpenFolderStopDialog, useOpenFolderIntake } from "@/components/layout/OpenFolderGuards";
import { QuickActionOffer } from "@/components/layout/QuickActionOffer";
import { COMPILE_SUCCEEDED_EVENT } from "@/lib/compile-checkpoint";
import {
  CHECKPOINT_PUBLICATION_EVENT,
  applyCheckpointPublicationEvent,
} from "@/lib/checkpoint-publication";

import { applyRemoteCompileSuccess } from "@/lib/compile-sync";
import { handleDockShortcut } from "@/lib/dock-shortcuts";
import { historyCommand, inPlainField, runFieldHistory } from "@/lib/field-history";
import {
  startNativeDockShortcutBridge,
  usesNativeDockMenu,
} from "@/lib/native-dock-shortcuts";
import type { ProjectStateChanged } from "@/lib/tauri";
import {
  FILE_SIDEBAR_MIN_WIDTH,
  assistantMinimumWidth,
  sidebarMinimumPercent,
  sidebarPanelGroupWidth,
} from "@/lib/assistant-layout";
import {
  applyExternalFileChange,
  refreshOpenFilesFromDisk,
  type ExternalFileChangePayload,
} from "@/lib/external-file-changes";

const SettingsModal = lazy(() =>
  import("@/components/layout/SettingsModal").then((m) => ({ default: m.SettingsModal })),
);
const DiagramComposer = lazy(() =>
  import("@/components/diagram/DiagramComposer").then((m) => ({ default: m.DiagramComposer })),
);
const DiagramComposerChooserHost = lazy(() =>
  import("@/components/diagram/composer-chooser/DiagramComposerChooser").then((m) => ({
    default: m.DiagramComposerChooserHost,
  })),
);
const CopilotOverlay = lazy(() =>
  import("@/components/ai/CopilotOverlay").then((m) => ({ default: m.CopilotOverlay })),
);
const WordCountModal = lazy(() =>
  import("@/components/editor/WordCountModal").then((m) => ({ default: m.WordCountModal })),
);
const VersioningModal = lazy(() =>
  import("@/components/editor/VersioningModal").then((m) => ({
    default: m.VersioningModal,
  })),
);
const HotkeysModal = lazy(() =>
  import("@/components/editor/HotkeysModal").then((m) => ({ default: m.HotkeysModal })),
);
const TourGuide = lazy(() =>
  import("@/components/tour/TourGuide").then((m) => ({ default: m.TourGuide })),
);
const StatsToolView = lazy(() =>
  import("@/components/tools/StatsToolView").then((m) => ({ default: m.StatsToolView })),
);
const GeneratorsToolView = lazy(() =>
  import("@/components/tools/GeneratorsToolView").then((m) => ({ default: m.GeneratorsToolView })),
);
const SymbolsToolView = lazy(() =>
  import("@/components/tools/SymbolsToolView").then((m) => ({ default: m.SymbolsToolView })),
);
const EquationToolView = lazy(() =>
  import("@/components/tools/EquationToolView").then((m) => ({ default: m.EquationToolView })),
);
const ConverterToolView = lazy(() =>
  import("@/components/tools/ConverterToolView").then((m) => ({ default: m.ConverterToolView })),
);
const ReferenceToolView = lazy(() =>
  import("@/components/tools/ReferenceToolView").then((m) => ({ default: m.ReferenceToolView })),
);
const LiteratureSearchToolView = lazy(() =>
  import("@/components/tools/LiteratureSearchToolView").then((m) => ({
    default: m.LiteratureSearchToolView,
  })),
);
const TerminalDock = lazy(() =>
  import("@/components/dock/TerminalDock").then((m) => ({ default: memo(m.TerminalDock) })),
);

const WorkspaceSidebar = memo(Sidebar);
const WorkspaceEditor = memo(Editor);
const WorkspacePreview = memo(PreviewPane);
const WorkspaceAssistant = memo(ChatPanel);

// fallback must stay null - a visible one blocks the whole screen (these mount unconditionally, closed by default).
function LazyModals({ children }: Readonly<{ children: ReactNode }>) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

// One-chunk-fetch placeholder for the lazy editor/preview surfaces: quiet,
// centered, and shaped like the boot progress card so loading reads as one
// continuous system.
function SurfaceLoading({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <span className="ai-shimmer">{label}…</span>
      </div>
    </div>
  );
}

function VHandle({
  id,
  onKeyDownCapture,
}: Readonly<{
  id: string;
  onKeyDownCapture: KeyboardEventHandler<HTMLElement>;
}>) {
  return (
    <Separator
      id={id}
      disableDoubleClick
      onKeyDownCapture={onKeyDownCapture}
      style={{ cursor: "col-resize" }}
      className="resize-handle-col group relative flex w-1.5 shrink-0 select-none bg-background"
    >
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          "transition-colors hover:bg-accent/40"
        )}
      >
        <span
          className={cn(
            "pointer-events-none h-10 w-1 rounded-full bg-border transition-colors",
            "group-hover:bg-ring group-data-[separator=active]:bg-ring"
          )}
        />
      </span>
    </Separator>
  );
}

const VERTICAL_PANELS = ["content-band", "terminal"];
const HORIZONTAL_PANELS = ["sidebar", "editorpdf", "assistant"];
const DOCUMENT_PANELS = ["editor", "pdf"];
const VERTICAL_LIMITS = {
  "content-band": { minSize: 25 },
  terminal: { minSize: 10, collapsible: true, collapsedSize: 0 },
} satisfies Record<string, PanelLimits>;
const DOCUMENT_LIMITS = {
  editor: { minSize: 15 },
  pdf: { minSize: 15 },
} satisfies Record<string, PanelLimits>;

function closeAssistant() {
  const settings = useSettingsStore.getState();
  if (settings.assistantOpen) settings.setAssistantOpen(false);
}

function workspaceGroupId(projectId: string | null, group: string): string | undefined {
  return projectId ? workspacePanelId(projectId, group) : undefined;
}

const AUTO_COMPILE_DEBOUNCE_MS = 2500;
const WINDOW_WAKE_COALESCE_MS = 1_000;
// Deactivated for 0.3.7 — see the comment at its use in the on-open effect.
const RESTORE_PREVIEW_FROM_FINGERPRINT = false;

// The document editors are contenteditable surfaces (.cm-content,
// .ProseMirror), so classify them BEFORE the plain-field check; a plain
// field also includes the inputs CodeMirror mounts inside its own panels
// (find/replace), which must undo their own text, not the document. Plain
// fields get an explicit execCommand undo so the behavior is identical on
// every platform's webview.
function sourceEditorOwns(active: HTMLElement | null): boolean {
  const source = getEditorView();
  return !!active && !!source && source.contentDOM.contains(active);
}

function secondaryCodeEditorOwns(active: HTMLElement | null): boolean {
  return !!active?.closest(".cm-content") && !sourceEditorOwns(active);
}

function runSecondaryEditorHistory(active: HTMLElement | null, redo: boolean): void {
  const host = active?.closest(".cm-editor") ?? active?.closest(".cm-content");
  const view = host ? EditorView.findFromDOM(host as HTMLElement) : null;
  if (!view) return;
  if (redo) cmRedo(view);
  else cmUndo(view);
}

function runDocumentMenuHistory(active: HTMLElement | null, redo: boolean): void {
  // Native menu events have no key event for Vim to intercept. Use its
  // history adapter directly so menu Undo/Redo preserves modal cursor and
  // selection semantics just like the keyboard route.
  if (!active?.closest(".ProseMirror") && useSettingsStore.getState().vim) {
    const handled = redo ? editorVimRedo() : editorVimUndo();
    if (handled) return;
  }
  if (redo) editorRedo();
  else editorUndo();
}

function runMenuHistory(redo: boolean): void {
  if (!useFilesStore.getState().projectId) return;
  const active = document.activeElement as HTMLElement | null;
  if (inPlainField(active)) {
    runFieldHistory(document, redo ? "redo" : "undo");
    return;
  }
  // A secondary CodeMirror surface owns its own history; never redirect
  // its menu click into the paper's source buffer.
  if (secondaryCodeEditorOwns(active)) {
    runSecondaryEditorHistory(active, redo);
    return;
  }
  runDocumentMenuHistory(active, redo);
}

function loadMcpBridge(): Promise<() => void> {
  return import("@/lib/mcp-bridge").then((m) => m.startMcpBridge());
}

const SIDEBAR_DEFAULT_PX = 340;

function shownViewMode(detached: boolean, selected: ViewMode): ViewMode {
  return detached ? "editor" : selected;
}

function horizontalPanelSizes(groupWidth: number, appFontSize: number, workspaceHidden: boolean) {
  const sidebarDefaultSize =
    groupWidth > 0 ? Math.min(65, (SIDEBAR_DEFAULT_PX / groupWidth) * 100) : 15;
  const assistantMinSize =
    groupWidth > 0
      ? Math.min(55, (assistantMinimumWidth(appFontSize) / groupWidth) * 100)
      : 22;
  const assistantDefaultSize = workspaceHidden ? 100 : Math.max(28, assistantMinSize);
  return { sidebarDefaultSize, assistantMinSize, assistantDefaultSize };
}

function splitPanelDefaultSize(viewMode: ViewMode): number {
  return viewMode === "split" ? 50 : 100;
}

function defaultVerticalLayout(terminalOpen: boolean): Layout {
  return {
    "content-band": terminalOpen ? 72 : 100,
    terminal: terminalOpen ? 28 : 0,
  };
}

function AppContent() {
  const { t } = useTranslation(["workspace"]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshProjects = useFilesStore((s) => s.refreshProjects);
  const recompile = useCompileStore((s) => s.recompile);
  const selectedViewMode = useSettingsStore((s) => s.viewMode);
  const detached = usePreviewDetachedStore((s) => s.projectId === projectId && projectId !== null);
  const viewMode = shownViewMode(detached, selectedViewMode);
  const showTree = useSettingsStore((s) => s.showTree);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const appFontSize = useSettingsStore((s) => s.appFontSize);
  const appFontFamily = useSettingsStore((s) => s.appFontFamily);
  const editorFontFamily = useSettingsStore((s) => s.editorFontFamily);
  const editorLineHeight = useSettingsStore((s) => s.editorLineHeight);
  const editorCustomLineHeight = useSettingsStore((s) => s.editorCustomLineHeight);
  const editorCursorWidth = useSettingsStore((s) => s.editorCursorWidth);
  const editorCursorColorLight = useSettingsStore((s) => s.editorCursorColorLight);
  const editorCursorColorDark = useSettingsStore((s) => s.editorCursorColorDark);
  const accentColor = useSettingsStore((s) => s.accentColor);
  const chatFloating = useSettingsStore((s) => s.chatFloating);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const workspaceHidden = useSettingsStore((s) => s.workspaceHidden);
  const zenCenterEditor = useSettingsStore((s) => s.zenCenterEditor);
  const zen = useZenStore((s) => s.active);
  const zenProjectId = useZenStore((s) => s.projectId);
  const zenCentered = zen && zenCenterEditor && viewMode === "editor";
  const previewHost = useKeptAliveHost("h-full min-h-0 min-w-0");
  const previewShown = !workspaceHidden && viewMode !== "editor";
  const [previewKeptFor, setPreviewKeptFor] = useState<string | null>(null);
  useEffect(() => {
    if (!previewShown || projectId === null) return;
    const settings = useSettingsStore.getState();
    if (settings.workspaceHidden || settings.viewMode === "editor") return;
    setPreviewKeptFor(projectId);
  }, [previewShown, projectId]);
  const keepPreview =
    !detached && projectId !== null && (previewShown || previewKeptFor === projectId);
  const homePage = useHomeViewStore((state) => state.page);
  const projectToolOpen = homePage === "generators" || homePage === "symbols";
  const projectComposerOpen = homePage === "diagram-composer";
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const editorPanelRef = useRef<PanelImperativeHandle>(null);
  const pdfPanelRef = useRef<PanelImperativeHandle>(null);
  const terminalPanelRef = useRef<PanelImperativeHandle>(null);
  const verticalGroupRef = useRef<GroupImperativeHandle>(null);
  const horizontalGroupRef = useRef<GroupImperativeHandle>(null);
  const documentGroupRef = useRef<GroupImperativeHandle>(null);
  const verticalGroupId = workspaceGroupId(projectId, "vertical");
  const horizontalGroupId = workspaceGroupId(projectId, "horizontal");
  const documentGroupId = workspaceGroupId(projectId, "document");
  const hasStoredHorizontalLayout = useMemo(
    () => (horizontalGroupId ? hasStoredPanelLayout(horizontalGroupId) : false),
    [horizontalGroupId],
  );
  const verticalLayout = usePersistentPanelLayout(verticalGroupId, VERTICAL_PANELS, VERTICAL_PANELS);
  const documentLayout = usePersistentPanelLayout(
    documentGroupId,
    DOCUMENT_PANELS,
    DOCUMENT_PANELS.filter(
      (id) => (id === "editor" && viewMode !== "pdf") || (id === "pdf" && viewMode !== "editor"),
    ),
  );
  const trackVerticalCollapse = useCollapseTransitions();
  const onVerticalSeparatorKeyDown = useSeparatorKeyboard(verticalGroupRef, VERTICAL_LIMITS);
  const onDocumentSeparatorKeyDown = useSeparatorKeyboard(documentGroupRef, DOCUMENT_LIMITS);
  const separatorHitArea = useSeparatorHitArea(0.375);

  useLayoutEffect(() => {
    if (projectId) return restoreWorkspaceLayout(projectId);
  }, [projectId]);

  useEffect(() => {
    if (zenProjectId !== null && zenProjectId !== projectId) exitZenMode({ restoreLayout: false });
  }, [projectId, zenProjectId]);

  useLayoutEffect(() => {
    if (!projectId) return;
    const groupId = workspacePanelId(projectId, "vertical");
    return afterPanelLayout(
      () => terminalPanelRef.current,
      (panel) => {
        if (terminalOpen) expandPanel(groupId, "terminal", panel, 30);
        else collapsePanel(groupId, "terminal", panel);
      },
    );
  }, [terminalOpen, projectId]);

  // The browser opens as its own window, so computer use just needs a CUA
  // surface whose navigate opens/replaces that window; there is no dock to
  // reveal. The computer_use tool is only exposed when the browser flag is on.
  useEffect(() => registerBrowserCuaSurface(), []);

  useOpenFolderIntake();

  const panelAreaRef = useRef<HTMLDivElement>(null);
  const [panelAreaWidth, setPanelAreaWidth] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    const el = panelAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPanelAreaWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [projectId]);
  const panelGroupWidth = sidebarPanelGroupWidth(panelAreaWidth, appFontSize);
  const sidebarMinSize = sidebarMinimumPercent(
    panelGroupWidth,
    false,
    appFontSize,
  );
  const { sidebarDefaultSize, assistantMinSize, assistantDefaultSize } = horizontalPanelSizes(
    panelGroupWidth,
    appFontSize,
    workspaceHidden,
  );
  const workspacePanelDefaultSize = splitPanelDefaultSize(viewMode);
  const horizontalLimits = useMemo(
    () =>
      ({
        sidebar: { minSize: sidebarMinSize, maxSize: 65 },
        editorpdf: {},
        assistant: {
          minSize: assistantMinSize,
          maxSize: workspaceHidden ? 100 : 55,
          collapsible: true,
          collapsedSize: 0,
        },
      }) satisfies Record<string, PanelLimits>,
    [assistantMinSize, sidebarMinSize, workspaceHidden],
  );
  const horizontalLayout = useDismissiblePanelLayout(
    horizontalGroupRef,
    horizontalGroupId,
    HORIZONTAL_PANELS,
    HORIZONTAL_PANELS.filter(
      (id) =>
        (id === "sidebar" && showTree) ||
        (id === "editorpdf" && !workspaceHidden) ||
        (id === "assistant" && assistantOpen),
    ),
    horizontalLimits,
    { id: "assistant", defaultSize: assistantDefaultSize, onDismiss: closeAssistant },
  );
  const onHorizontalSeparatorKeyDown = useSeparatorKeyboard(horizontalGroupRef, horizontalLimits);

  useEffect(() => {
    // React owns the screen from here: retire the inline HTML splash and
    // stamp the boot milestones the BootProgress card reports against.
    markBootStage("react-mounted");
    if (!bootSplashHeld()) dismissBootSplash();
    void refreshProjects();
    void useGithubStore.getState().refresh();
    markBootStage("stores-ready");
  }, [refreshProjects]);

  // Closing a project (or a fresh launch) always lands back on the library,
  // unless a global tool command explicitly queued another home page.
  useEffect(() => {
    if (!projectId) {
      const home = useHomeViewStore.getState();
      home.goTo(home.consumeQueuedPageAfterProjectClose() ?? "library");
    }
  }, [projectId]);

  useSteadyPanelWidth({
    panelRef: sidebarPanelRef,
    active: showTree,
    groupWidth: panelGroupWidth,
    defaultSize: sidebarDefaultSize,
    applyDefault: !hasStoredHorizontalLayout,
  });

  // No-op in dev / the browser; only prompts if an update is actually available.
  useEffect(() => {
    const id = window.setTimeout(() => checkForUpdatesOnStartup(), 3000);
    return () => window.clearTimeout(id);
  }, []);

  const native = isTauri();

  // Manual mode so it reports "up to date" rather than closing silently.
  useTauriEvent("menu://check-updates", () => void openUpdateWindow({ manual: true }), native);
  useTauriEvent("menu://about", () => setAboutOpen(true), native);
  useTauriSubscription(startNativeDockShortcutBridge, "start the dock shortcut bridge");

  useEffect(() => {
    if (!native) return;
    // Done here, not at module load, so it never fires IPC at import time.
    void import("@/lib/ai-tools").then((m) => m.initAiPdfCaptureFlag());
  }, [native]);
  useTauriSubscription(native ? loadMcpBridge : null, "start the MCP bridge");

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--cm-font-size", `${editorFontSize}px`);
    applyAppTypography(appFontFamily, appFontSize, root);
    const editorFont = fontFamilyName(editorFontFamily);
    if (editorFont) {
      root.style.setProperty("--cm-font-family", fontFamilyStack(editorFont, "var(--font-mono)"));
    } else {
      root.style.removeProperty("--cm-font-family");
    }
    root.style.setProperty(
      "--cm-line-height",
      String(editorLineHeightValue(editorLineHeight, editorCustomLineHeight)),
    );
    root.style.setProperty("--cm-cursor-width", `${editorCursorWidth}px`);
    for (const [surface, color] of [
      ["light", editorCursorColorLight],
      ["dark", editorCursorColorDark],
    ] as const) {
      if (color) root.style.setProperty(`--cm-cursor-custom-${surface}`, color);
      else root.style.removeProperty(`--cm-cursor-custom-${surface}`);
    }
    getEditorView()?.requestMeasure();
  }, [
    editorFontSize,
    appFontSize,
    appFontFamily,
    editorFontFamily,
    editorLineHeight,
    editorCustomLineHeight,
    editorCursorWidth,
    editorCursorColorLight,
    editorCursorColorDark,
  ]);

  useEffect(() => {
    const apply = (theme: Theme) => applyAccentColor(theme, accentColor);
    apply(currentTheme());
    return subscribeTheme(apply);
  }, [accentColor]);

  // SourceControl / DiffView refresh after git mutations; we only re-poll on
  // project switch, window focus, and a slow interval (no 5s hot loop).
  const refreshGitStatus = useGitStatusStore((s) => s.refresh);
  useEffect(() => {
    refreshGitStatus(projectId);
  }, [projectId, refreshGitStatus]);
  useEffect(() => {
    const tick = () => refreshGitStatus(useFilesStore.getState().projectId);
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, 60_000);
    let lastWake = Number.NEGATIVE_INFINITY;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastWake < WINDOW_WAKE_COALESCE_MS) return;
      lastWake = now;
      tick();
      refreshOpenFilesFromDisk(useFilesStore.getState().projectId);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshGitStatus]);

  useEffect(() => {
    const s = useSettingsStore.getState();
    // Clear the previous project's compile output so a stale PDF never shows.
    useCompileStore.getState().reset();
    // Preflight results belong to the previous project; reset them too.
    usePreflightStore.getState().reset();
    if (projectId) {
      s.setRailTab("files");
    }
  }, [projectId]);

  useEffect(() => {
    void import("@/lib/preview-window").then((m) => m.restorePreviewWindow(projectId, useFilesStore.getState().projectName ?? ""));
  }, [projectId]);

  useTauriSubscription(startPreviewWorkspaceBridge, "start the preview workspace bridge");

  // Detached AI chat / preview windows can mutate disk; reload open buffers
  // and the compiled PDF when they report changes.
  useTauriEvent<ExternalFileChangePayload>(
    "project:files-changed",
    (payload) => {
      if (payload) applyExternalFileChange(payload, getCurrentWindow().label);
    },
    native,
  );
  useTauriEvent<unknown>(
    COMPILE_SUCCEEDED_EVENT,
    (payload) => void applyRemoteCompileSuccess(payload, getCurrentWindow().label),
    native,
  );
  useTauriEvent<unknown>(CHECKPOINT_PUBLICATION_EVENT, applyCheckpointPublicationEvent, native);
  useTauriEvent<ProjectStateChanged>(
    "project-state-changed",
    (payload) => {
      const files = useFilesStore.getState();
      if (!payload || payload.projectId !== files.projectId) return;
      void files.applyProjectStateChanged(payload).then((applied) => {
        if (applied) usePreflightStore.getState().reset();
      });
    },
    native,
  );
  useTauriEvent<{ section?: string }>(
    "settings:open",
    (payload) => {
      if (useTourStore.getState().activeTourId) return;
      const s = useSettingsStore.getState();
      if (payload?.section) s.setSettingsInitialSection(payload.section);
      s.setSettingsOpen(true);
    },
    native,
  );

  // Manual recompile: Cmd/Ctrl + Enter. Forward SyncTeX: Cmd/Ctrl + Shift + J.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      const bindings = useShortcutStore.getState().bindings;
      if (matchesShortcut(e, bindings.recompile)) {
        e.preventDefault();
        revealPreviewForCompile();
        void recompile();
      } else if (matchesShortcut(e, bindings.forwardSync)) {
        e.preventDefault();
        void forwardFromCursor();
      } else if (matchesShortcut(e, bindings.shortcutReference)) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        useSettingsStore.getState().setHotkeysOpen(true);
      } else if (matchesShortcut(e, bindings.openSettings) && !usesNativeDockMenu()) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        useSettingsStore.getState().setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recompile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      if (!useFilesStore.getState().projectId) return;
      if (matchesShortcut(e, useShortcutStore.getState().bindings.toggleSidebar)) {
        // Cmd/Ctrl+B means bold inside the source and visual editors; the
        // sidebar toggle must not shadow it there.
        const el = document.activeElement as HTMLElement | null;
        if (el?.closest(".cm-editor") || el?.closest(".ProseMirror")) return;
        e.preventDefault();
        e.stopPropagation();
        useSettingsStore.getState().toggleTree();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Undo/redo is handled in the webview on every platform. The Edit menu's
  // Undo/Redo carry no accelerator (that would double-fire on Windows/Linux,
  // where the menu and the webview can both receive the key), so the keystroke
  // reaches this handler uniformly. Route by focus: a plain field (title,
  // search, chat) keeps its own native undo; the editor, its toolbar, and
  // anywhere else drive the document's history. The menu items still work as
  // clicks, routed through the same logic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = historyCommand(e);
      if (!command) return;
      const isRedo = command === "redo";
      if (useTourStore.getState().activeTourId) return;
      if (!useFilesStore.getState().projectId) return;
      const active = document.activeElement as HTMLElement | null;
      if (secondaryCodeEditorOwns(active)) return;
      // Once Vim owns the source editor, let its modal handler see the key
      // first. Keys it declines still fall through to CodeMirror's ordinary
      // history keymap; capturing them here bypasses Vim entirely.
      const vimEnabled = useSettingsStore.getState().vim;
      if (sourceEditorOwns(active) && vimEnabled) return;
      e.preventDefault();
      e.stopPropagation();
      if (inPlainField(active)) {
        runFieldHistory(document, isRedo ? "redo" : "undo");
        return;
      }
      // Toolbar and other document chrome still target the source editor. In
      // Vim mode, route that history request through Vim so it restores modal
      // cursor and selection state instead of applying bare CM6 history.
      if (!active?.closest(".ProseMirror") && vimEnabled) {
        const handled = isRedo ? editorVimRedo() : editorVimUndo();
        if (handled) return;
      }
      if (isRedo) editorRedo();
      else editorUndo();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useTauriEvent("menu://undo", () => runMenuHistory(false), native);
  useTauriEvent("menu://redo", () => runMenuHistory(true), native);

  useEffect(() => {
    if (!projectId || usesNativeDockMenu()) return;
    const onKey = (event: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      handleDockShortcut(event);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId]);

  if (!projectId) {
    return (
      <ThemeProvider>
        <Library />
        <CommandPalette />
        <SearchOmnibar />
        <GlobalNewProject />
        <CopyIntoLibraryDialog />
        <Suspense fallback={null}>
          {homePage === "pdf-import" && <PdfImportView />}
          {homePage === "equation" && <EquationToolView />}
          {homePage === "converter" && <ConverterToolView />}
          {homePage === "reference" && <ReferenceToolView />}
          {homePage === "bibtex" && <BibtexToolView />}
          {homePage === "table" && <TableToolView />}
          {homePage === "lab-search" && <LabSearchToolView />}
          {homePage === "literature-search" && <LiteratureSearchToolView />}
          {homePage === "deadlines" && <DeadlinesView />}
          {homePage === "stats" && <StatsToolView />}
          {homePage === "generators" && <GeneratorsToolView />}
          {homePage === "symbols" && <SymbolsToolView />}
          {homePage === "tools" && <LatexToolsView />}
        </Suspense>
        <ExternalToolApprovals />
        <EnginePickerModal />
        <TinytexGuards />
        <QuitGuard />
        <SaveBlockedDialog />
        <OpenFolderStopDialog />
        <QuickActionOffer />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {chatFloating && (
          <Suspense fallback={null}>
            <CopilotOverlay />
          </Suspense>
        )}
        <LazyModals>
          <SettingsModal />
          <CiteOleaflyDialog />
          <HotkeysModal />
          <DiagramComposer />
          <DiagramComposerChooserHost />
          <TourGuide />
        </LazyModals>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div
        data-sidebar-open={showTree ? "true" : "false"}
        data-zen={zen ? "true" : undefined}
        data-zen-centered={zenCentered ? "true" : undefined}
        className="flex h-full flex-col"
      >
        <div className="contents" inert={projectToolOpen || projectComposerOpen || undefined}>
          {/* Drives the gutter's horizontal metrics: the line-number column gives
              back a few pixels only while the sidebar is competing for the width
              (see globals.css). */}
          <div hidden={zen} className={zen ? undefined : "contents"}>
            <TopToolbar />
          </div>
          {zen && <ZenTitleStrip />}
        <BackendProtocolBanner />
        <FolderUnavailableBanner />
        <OpenedFolderBanners />
        <ShellCommandsBanner />
        <div ref={panelAreaRef} className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <ErrorBoundary
            resetKey={projectId}
            fallback={
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <p>{t(($) => $.workspace.panelError.message)}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  <RefreshCw className="size-4" />
                  {t(($) => $.workspace.panelError.reload)}
                </button>
              </div>
            }
          >
            <Group
              key={projectId}
              groupRef={verticalGroupRef}
              orientation="vertical"
              defaultLayout={verticalLayout.defaultLayout ?? defaultVerticalLayout(terminalOpen)}
              onLayoutChange={(layout: Layout) =>
                trackVerticalCollapse(layout, {
                  terminal: {
                    collapsedSize: 0,
                    onCollapse: () => {
                      if (useSettingsStore.getState().terminalOpen) {
                        useSettingsStore.getState().setTerminalOpen(false);
                      }
                    },
                    onExpand: () => {
                      if (!useSettingsStore.getState().terminalOpen) {
                        useSettingsStore.getState().setTerminalOpen(true);
                      }
                    },
                  },
                })
              }
              onLayoutChanged={verticalLayout.onLayoutChanged}
              resizeTargetMinimumSize={separatorHitArea}
              className="min-h-0 min-w-0 flex-1"
            >
              <Panel
                id="content-band"
                defaultSize={percent(72)}
                {...panelLimitProps(VERTICAL_LIMITS["content-band"])}
                style={PANEL_STYLE}
                className="min-h-0 min-w-0"
              >
                <Group
                  groupRef={horizontalGroupRef}
                  orientation="horizontal"
                  defaultLayout={horizontalLayout.defaultLayout}
                  onLayoutChange={horizontalLayout.onLayoutChange}
                  onLayoutChanged={horizontalLayout.onLayoutChanged}
                  resizeTargetMinimumSize={separatorHitArea}
                  className="h-full min-h-0 min-w-0"
                >
              {showTree && (
                <Fragment key="sidebar">
                  <Panel
                    panelRef={sidebarPanelRef}
                    id="sidebar"
                    defaultSize={percent(sidebarDefaultSize)}
                    {...panelLimitProps(horizontalLimits.sidebar)}
                    minSize={`${FILE_SIDEBAR_MIN_WIDTH}px`}
                    groupResizeBehavior="preserve-pixel-size"
                    style={PANEL_STYLE}
                    className="bg-sidebar"
                  >
                    <WorkspaceSidebar />
                  </Panel>
                  <VHandle id="h-tree" onKeyDownCapture={onHorizontalSeparatorKeyDown} />
                </Fragment>
              )}

              {!workspaceHidden && (
              <Panel
                  key="editorpdf"
                  id="editorpdf"
                  defaultSize={percent(showTree ? 85 : 100)}
                  {...panelLimitProps(horizontalLimits.editorpdf)}
                  style={PANEL_STYLE}
                  className="min-h-0 min-w-0"
                >
                  <Group
                    groupRef={documentGroupRef}
                    orientation="horizontal"
                    defaultLayout={documentLayout.defaultLayout}
                    onLayoutChanged={documentLayout.onLayoutChanged}
                    resizeTargetMinimumSize={separatorHitArea}
                    className="h-full min-h-0 min-w-0"
                  >
                        {viewMode !== "pdf" && (
                          <Panel
                            panelRef={editorPanelRef}
                            id="editor"
                            defaultSize={percent(workspacePanelDefaultSize)}
                            {...panelLimitProps(DOCUMENT_LIMITS.editor)}
                            style={PANEL_STYLE}
                            className="min-h-0 min-w-0"
                          >
                            <ErrorBoundary surface="editor" resetKey={projectId}>
                              <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.editor)} />}>
                                <WorkspaceEditor />
                              </Suspense>
                            </ErrorBoundary>
                          </Panel>
                        )}
                        {viewMode === "split" && (
                          <VHandle id="h-mid" onKeyDownCapture={onDocumentSeparatorKeyDown} />
                        )}
                        {viewMode !== "editor" && (
                          <Panel
                            panelRef={pdfPanelRef}
                            id="pdf"
                            defaultSize={percent(workspacePanelDefaultSize)}
                            {...panelLimitProps(DOCUMENT_LIMITS.pdf)}
                            style={PANEL_STYLE}
                            className="min-h-0 min-w-0"
                          >
                            <KeptAliveSlot host={previewHost} className="h-full min-h-0 min-w-0" />
                          </Panel>
                        )}
                  </Group>
                </Panel>
              )}

              {assistantOpen && (
                <Fragment key="assistant">
                  {!workspaceHidden && (
                    <VHandle id="h-assistant" onKeyDownCapture={onHorizontalSeparatorKeyDown} />
                  )}
                  <Panel
                    id="assistant"
                    defaultSize={percent(assistantDefaultSize)}
                    {...panelLimitProps(horizontalLimits.assistant)}
                    style={PANEL_STYLE}
                    className="min-h-0 min-w-0 border-l"
                  >
                    <ErrorBoundary surface="AI assistant" resetKey={projectId}>
                      <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.assistant)} />}>
                        <WorkspaceAssistant />
                      </Suspense>
                    </ErrorBoundary>
                  </Panel>
                </Fragment>
              )}
                </Group>
              </Panel>
              <Separator
                id="v-terminal"
                disabled={!terminalOpen}
                disableDoubleClick
                onKeyDownCapture={onVerticalSeparatorKeyDown}
                style={{ cursor: "row-resize" }}
                className={cn(
                  // A border-coloured rule on an opaque base. A translucent hover
                  // fill here let the window's vibrancy show through as a dark strip.
                  "resize-handle-row group relative z-10 h-px select-none border-t bg-background",
                  // Hover target a little wider than the rule; the drag target is
                  // the group's resizeTargetMinimumSize.
                  "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
                  !terminalOpen && "invisible h-0 overflow-hidden border-t-0",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 opacity-0 transition-opacity",
                    "bg-[color-mix(in_srgb,var(--ring)_40%,var(--background))]",
                    "group-hover:opacity-100 group-data-[separator=hover]:opacity-100 group-data-[separator=active]:opacity-100",
                  )}
                />
              </Separator>
              <Panel
                panelRef={terminalPanelRef}
                id="terminal"
                defaultSize={percent(28)}
                {...panelLimitProps(VERTICAL_LIMITS.terminal)}
                style={PANEL_STYLE}
                className="min-h-0 min-w-0"
              >
                <div
                  className={cn(
                    "h-full min-h-0 min-w-0",
                    !terminalOpen && "invisible pointer-events-none",
                  )}
                >
                  <ErrorBoundary surface="terminal dock" resetKey={projectId}>
                    <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.terminal)} />}>
                      <TerminalDock
                        projectId={projectId}
                        projectName={projectName}
                        visible={terminalOpen}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </Panel>
            </Group>
          </ErrorBoundary>
          {keepPreview &&
            createPortal(
              <ErrorBoundary surface="PDF preview" resetKey={projectId}>
                <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.preview)} />}>
                  <WorkspacePreview active={previewShown} />
                </Suspense>
              </ErrorBoundary>,
              previewHost,
            )}
        </div>

        <CommandPalette />
        <SearchOmnibar />
        <GlobalNewProject />
        <CopyIntoLibraryDialog />
        <AssistantOutputsBridge />
        <ExternalToolApprovals />
        <EnginePickerModal />
        <MainDocumentPicker />
        <TinytexGuards />
        <QuitGuard />
        <SaveBlockedDialog />
        <OpenFolderStopDialog />
        <QuickActionOffer />
        <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {chatFloating && !zen && (
          <Suspense fallback={null}>
            <CopilotOverlay />
          </Suspense>
        )}
        {zen && <ZenSession />}
        {zen && <ZenCompileCorner />}
        <LazyModals>
          <CiteOleaflyDialog />
          <WordCountModal />
          <VersioningModal />
          <HotkeysModal />
          <TourGuide />
        </LazyModals>
        </div>
        <LazyModals>
          <SettingsModal />
          <DiagramComposer />
          <DiagramComposerChooserHost />
        </LazyModals>
        {projectToolOpen && (
          <Suspense fallback={null}>
            <div className="fixed inset-0 z-[70]">
              {homePage === "generators" ? <GeneratorsToolView /> : <SymbolsToolView />}
            </div>
          </Suspense>
        )}
      </div>
    </ThemeProvider>
  );
}

/**
 * Watches document text without making the complete AppContent layout a
 * subscriber. A book-sized edit should reschedule auto-compile, not re-render
 * the toolbar, panel tree, editor shell and PDF preview on every keystroke.
 */
function AutoCompileKeeper() {
  const projectId = useFilesStore((state) => state.projectId);
  const activePath = useFilesStore((state) => state.activePath);
  const activeContent = useActiveContent();
  const autoCompile = useCompileStore((state) => state.autoCompile);
  const recompile = useCompileStore((state) => state.recompile);
  const pathRef = useRef<string | null>(null);

  useEffect(() => {
    void activeContent;
    if (!autoCompile || !projectId || typstLivePreviewWanted()) {
      pathRef.current = activePath;
      return;
    }
    // Active content changes on a file switch as well as an edit. Establish
    // the new file identity without compiling merely because it was opened.
    if (pathRef.current !== activePath) {
      pathRef.current = activePath;
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const editedAt = Date.now();
    const attempt = () => {
      if (cancelled || typstLivePreviewWanted()) return;
      if (useCompileStore.getState().status === "compiling") {
        stopOutdatedAutomaticCompile(editedAt);
        timer = setTimeout(attempt, 500);
        return;
      }
      void recompile({ origin: "automatic" });
    };
    timer = setTimeout(attempt, AUTO_COMPILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeContent, activePath, autoCompile, projectId, recompile]);

  return null;
}

function OpenCompileKeeper() {
  const projectId = useFilesStore((state) => state.projectId);
  const engineLoaded = useFilesStore((state) => state.engineLoaded);
  const projectLoading = useFilesStore((state) => state.loading);
  const mainDocument = useFilesStore((state) => state.mainDoc);
  const mainDecision = useFilesStore((state) => state.mainDecision);
  const mainDocumentLoaded = useFilesStore(
    (state) => state.files[state.mainDoc] !== undefined,
  );
  const recompile = useCompileStore((state) => state.recompile);
  const compileStatus = useCompileStore((state) => state.status);
  const compileCheckpoint = useCompileStore(
    (state) => state.lastCompileCheckpoint,
  );
  const analysisProjectId = useProjectAnalysisStore(
    (state) => state.snapshot.identity.projectId,
  );
  const analysisProjectRevision = useProjectAnalysisStore(
    (state) => state.snapshot.identity.projectRevision,
  );

  // Compile once when a project opens into a layout that shows the PDF pane,
  // so the user lands on a rendered preview instead of the placeholder. Keyed
  // on the tree, not projectId: projectId is set before the files (and the
  // main doc) are loaded, and compiling then would race the open.
  const tree = useFilesStore((s) => s.tree);
  const openCompiledRef = useRef<string | null>(null);
  const openCompileInFlightRef = useRef<string | null>(null);
  const openCompileRetriesRef = useRef<OpenCompileRetries | null>(null);
  const [openCompileEpoch, setOpenCompileEpoch] = useState(0);
  useEffect(() => {
    void openCompileEpoch;
    void mainDocumentLoaded;
    openCompiledRef.current = resetOpenCompileMarker(projectId, openCompiledRef.current);
    openCompileRetriesRef.current = resetOpenCompileMarker(
      projectId,
      openCompileRetriesRef.current,
    );
    if (
      projectId !== null &&
      openCompiledRef.current === projectId &&
      openCompileInFlightRef.current === null
    ) {
      return;
    }
    const hydrated = openCompileHydrated(
      projectLoading,
      projectId,
      analysisProjectId,
      analysisProjectRevision,
    );
    const hasValidCurrentArtifact =
      compileCheckpoint !== null &&
      isCompileCheckpointCurrent(compileCheckpoint);
    if (hasValidCurrentArtifact && projectId) {
      openCompiledRef.current = projectId;
      return;
    }
    if (
      openCompileInFlightRef.current !== null ||
      !automaticCompileAllowed(mainDecision) ||
      !shouldCompileOnOpen(
        projectId,
        tree.length > 0,
        engineLoaded,
        openCompiledRef.current,
        useSettingsStore.getState().viewMode,
        compileStatus,
        hydrated,
        hasValidCurrentArtifact,
      )
    ) {
      return;
    }

    const requestedProjectId = projectId;
    if (!requestedProjectId) return;
    const requestedMainDocument = mainDocument;
    const requestedProjectRevision = analysisProjectRevision;
    openCompileInFlightRef.current = requestedProjectId;
    const compileOrRestore = async () => {
      // Reopen fast path: seed the preview from the persisted compile
      // fingerprint and skip the on-open compile. DEACTIVATED for 0.3.7:
      // e2e caught that skipping the on-open compile breaks subsystems that
      // depended on it (logs pane, library thumbnails, the engine-gap
      // picker) and its activation depends on a write-vs-teardown race.
      // The fingerprint keeps being written and validated server-side; the
      // restore flips on once those flows are covered end to end.
      if (RESTORE_PREVIEW_FROM_FINGERPRINT) {
        const restored = await useCompileStore
          .getState()
          .restoreFromDisk(requestedProjectId, requestedMainDocument)
          .catch(() => false);
        if (restored) return undefined;
      }
      expectEngineChoiceOnOpen(requestedProjectId);
      return recompile({ origin: "automatic" });
    };
    void compileOrRestore().finally(() => {
      takeEngineChoiceOnOpen(requestedProjectId);
      const files = useFilesStore.getState();
      const analysis =
        useProjectAnalysisStore.getState().snapshot.identity;
      const compile = useCompileStore.getState();
      const settlement = settleOpenCompile(
        {
          projectId: requestedProjectId,
          mainDocument: requestedMainDocument,
          projectRevision: requestedProjectRevision,
        },
        {
          projectId: files.projectId,
          mainDocument: files.mainDoc,
          loading: files.loading,
          analysisProjectId: analysis.projectId,
          analysisProjectRevision: analysis.projectRevision,
          attempt: compile.lastAttemptIdentity,
          hasCurrentArtifact: isCompileCheckpointCurrent(
            compile.lastCompileCheckpoint,
          ),
        },
        openCompileRetriesRef.current,
      );
      openCompileRetriesRef.current = settlement.retries;
      if (settlement.compiled) {
        openCompiledRef.current = requestedProjectId;
      }
      if (
        openCompileInFlightRef.current === requestedProjectId
      ) {
        openCompileInFlightRef.current = null;
      }
      if (
        files.projectId &&
        files.projectId !== openCompiledRef.current
      ) {
        setOpenCompileEpoch((epoch) => epoch + 1);
      }
    });
  }, [
    analysisProjectId,
    analysisProjectRevision,
    compileCheckpoint,
    compileStatus,
    engineLoaded,
    mainDecision,
    mainDocument,
    mainDocumentLoaded,
    openCompileEpoch,
    projectId,
    projectLoading,
    recompile,
    tree,
  ]);

  return null;
}

export default function App() {
  return (
    <>
      <ErrorBoundary
        fallback={<LanguageServiceRuntimeUnavailable />}
      >
        <LanguageServiceRuntimeBoundary />
      </ErrorBoundary>
      <AutoCompileKeeper />
      <ProjectAvailabilityKeeper />
      <OpenFolderKeeper />
      <FolderWatchKeeper />
      <AppContent />
      <OpenCompileKeeper />
    </>
  );
}
