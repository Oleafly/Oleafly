import { startPreviewWorkspaceBridge } from "@/lib/preview-workspace";
import { usePreviewDetachedStore } from "@/store/preview-detached";
import { restoreWorkspaceLayout, workspacePanelId } from "@/lib/workspace-layout";
import { useTranslation } from "react-i18next";
import { CiteOleaflyDialog } from "@/components/layout/CiteOleaflyDialog";
import { memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HEAVY, lazy, startWarming, warmDeferred } from "@/lib/preloadable";
import { logError } from "@/lib/log";
import { createPortal } from "react-dom";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { RefreshCw } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { ThemeProvider, applyAccentColor, currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { Contained } from "@/components/Contained";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TopToolbar } from "@/components/layout/TopToolbar";
import { BackendProtocolBanner } from "@/components/layout/BackendProtocolBanner";
import { FolderUnavailableBanner } from "@/components/layout/FolderUnavailableBanner";
import { OpenedFolderBanners } from "@/components/open-folder/OpenedFolderBanners";
import { CollabActivitySlot, CollabSyncPauseSlot, ShareDialogHost } from "@/components/collab/CollabSlots";
import { ShellCommandsBanner } from "@/components/layout/ShellCommandsBanner";
import { isNotebookEngine } from "@/lib/notebook-engines";
import { ZenSession } from "@/components/layout/ZenSession";
import { ZenCompileCorner, ZenTitleStrip } from "@/components/layout/ZenChrome";
import { OpenFolderKeeper } from "@/components/open-folder/OpenFolderKeeper";
import { ProjectAvailabilityKeeper } from "@/components/layout/ProjectAvailabilityKeeper";
import { CloudSyncHost } from "@/components/cloud/CloudSyncHost";
import { FolderWatchKeeper } from "@/components/layout/FolderWatchKeeper";
import { CollabLiveKeeper } from "@/components/layout/CollabLiveKeeper";
import { CollabLinkKeeper } from "@/components/layout/CollabLinkKeeper";
import { Editor } from "@/components/editor/Editor";
import {
  editorUndo,
  editorRedo,
  editorVimUndo,
  editorVimRedo,
  getEditorView,
} from "@/components/editor/cm/controller";
import { getWysiwygEditor } from "@/components/editor/wysiwyg/controller";
import type { Editor as RichTextEditor } from "@tiptap/react";
import { PreviewPane } from "@/components/preview/PreviewPane";
import { useKeptAliveHost } from "@/components/layout/KeptAliveSlot";
import { PaneReorderProvider } from "@/components/layout/pane-reorder";
import { PaneTreeGroup, PaneTreeProvider, type PaneTreeConfig } from "@/components/layout/PaneTree";
import {
  groupNameOf,
  parentSplitOf,
  usePaneLayoutStore,
  type PaneId,
  type PaneShown,
} from "@/store/pane-layout";
import { PdfImportView } from "@/components/import/PdfImportView";
import { Sidebar } from "@/components/layout/Sidebar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { SearchOmnibar } from "@/components/layout/SearchOmnibar";
import { GlobalNewProject } from "@/components/library/GlobalNewProject";
import { SaveAsTemplateHost } from "@/components/library/SaveAsTemplateHost";
import { BibtexToolView } from "@/components/tools/BibtexToolView";
import { TableToolView } from "@/components/tools/TableToolView";
import { DeadlinesView } from "@/components/deadlines/DeadlinesView";
import { LatexToolsView } from "@/components/tools/LatexToolsView";
import { LabSearchToolView } from "@/components/tools/LabSearchToolView";
import { loadNamespace } from "@/i18n";
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
import { editorLetterSpacingValue, editorLineHeightValue, useSettingsStore, type ViewMode } from "@/store/settings";
import { editorCjkFontStack, fontFamilyName, fontFamilyStack, quotedFontFamily } from "@/lib/font-families";
import { applyAppTypography } from "@/lib/app-typography";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTourStore } from "@/store/tours";
import { useTypstFormsStore } from "@/store/typst-forms";
import { AVAILABLE_TOUR_IDS } from "@/lib/tours/registry";
import { START_TOUR_EVENT } from "@/lib/tour";
import { useDiagramComposerStore } from "@/store/diagram-composer";
import { OpeningIndicator } from "@/components/ui/opening-indicator";
import { mountOnFirstOpen } from "@/lib/mount-on-first-open";
import { coversProject, projectCovered } from "@/lib/project-covered";
import { noteHistoryAt } from "@/lib/open-note-editors";
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
import { forwardFromCursor } from "@/features/synctex";
import { checkForUpdatesOnStartup, openUpdateWindow } from "@/lib/updater";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriEvent, useTauriSubscription } from "@/hooks/use-tauri-event";
import { cn } from "@/lib/utils";
import {
  afterPanelLayout,
  collapsePanel,
  expandPanel,
  hasStoredPanelLayout,
  useSeparatorHitArea,
  useSteadyPanelWidth,
} from "@/lib/panel-layout";
import { AssistantOutputsBridge } from "@/components/ai/AssistantOutputsBridge";
import { ExternalToolApprovals } from "@/components/ai/ExternalToolApprovals";
import { ChatPanel } from "@/components/ai/ChatPanel";
import { AboutModal } from "@/components/layout/AboutModal";
import { expectEngineChoiceOnOpen, takeEngineChoiceOnOpen } from "@/store/engine-picker";
import { revealPreviewForCompile, togglePreviewPane } from "@/lib/compile-preview";
import { TinytexGuards } from "@/components/layout/TinytexGuards";
import { QuitGuard } from "@/components/layout/QuitGuard";
import { SaveBlockedDialog } from "@/components/layout/SaveBlockedDialog";
import { OpenFolderStopDialog, useOpenFolderIntake } from "@/components/layout/OpenFolderGuards";
import { useTemplateLinkIntake } from "@/features/template-link-intake";
import { COMPILE_SUCCEEDED_EVENT } from "@/lib/compile-checkpoint";
import {
  CHECKPOINT_PUBLICATION_EVENT,
  applyCheckpointPublicationEvent,
} from "@/lib/checkpoint-publication";

import { applyRemoteCompileSuccess } from "@/lib/compile-sync";
import { startDefaultLatexEngineSync } from "@/lib/default-latex-engine";
import { applyEditorColors } from "@/lib/editor-themes";
import { useEditorColorKey } from "@/hooks/use-editor-theme";
import { handleDockShortcut, handleTerminalTabShortcut } from "@/lib/dock-shortcuts";
import { isTerminalTarget } from "@/lib/terminal-keys";
import { terminalOwnsKey } from "@/lib/terminal-shortcut-guard";
import {
  historyCommand,
  inPlainField,
  inVisualForm,
  runFieldHistory,
  visualFormHistory,
} from "@/lib/field-history";
import {
  startNativeDockShortcutBridge,
  usesNativeDockMenu,
} from "@/lib/native-dock-shortcuts";
import type { ProjectStateChanged } from "@/lib/tauri";
import {
  assistantMinimumWidth,
  sidebarMinimumPercent,
  sidebarPanelGroupWidth,
} from "@/lib/assistant-layout";
import {
  applyExternalFileChange,
  refreshOpenFilesFromDisk,
  type ExternalFileChangePayload,
} from "@/lib/external-file-changes";

function useTourGuideWanted(): boolean {
  const wanted = useTourStore(
    (state) =>
      state.activeTourId !== null ||
      (state.enabled && AVAILABLE_TOUR_IDS.some((id) => state.tours[id].status === "pending")),
  );
  const requested = useTourStartRequests() > 0;
  return wanted || requested;
}

function useTourStartRequests(): number {
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    const request = () => setRequests((count) => count + 1);
    window.addEventListener(START_TOUR_EVENT, request);
    return () => window.removeEventListener(START_TOUR_EVENT, request);
  }, []);
  return requests;
}

const SettingsModal = mountOnFirstOpen(
  lazy(() => import("@/components/layout/SettingsModal").then((m) => ({ default: m.SettingsModal })), {
    warm: true,
    priority: 1,
  }),
  () => useSettingsStore((s) => s.settingsOpen),
  () => useSettingsStore.getState().setSettingsOpen(false),
  { loading: <OpeningIndicator /> },
);
const DiagramComposer = mountOnFirstOpen(
  lazy(() =>
    import("@/components/diagram/DiagramComposer").then((m) => ({ default: m.DiagramComposer })), { warm: true, priority: HEAVY }),
  () => useHomeViewStore((s) => s.page === "diagram-composer"),
  () => useHomeViewStore.getState().goTo("library"),
  { loading: <OpeningIndicator /> },
);
const NotesHost = mountOnFirstOpen(
  lazy(() =>
    Promise.all([import("@/components/notes/NotesHost"), loadNamespace("notes")]).then(([module]) => ({
      default: module.NotesHost,
    })), { warm: () => useSettingsStore.getState().notes }),
  () => useHomeViewStore((s) => s.page === "notes"),
  () => useHomeViewStore.getState().goTo("library"),
  { loading: <OpeningIndicator /> },
);
const DiagramComposerChooserHost = mountOnFirstOpen(
  lazy(() =>
    import("@/components/diagram/composer-chooser/DiagramComposerChooser").then((m) => ({
      default: m.DiagramComposerChooserHost,
    })), { warm: true }),
  () => useDiagramComposerStore((s) => s.chooserOpen),
  () => useDiagramComposerStore.getState().setChooserOpen(false),
  { loading: <OpeningIndicator /> },
);
const CopilotOverlay = lazy(() =>
  import("@/components/ai/CopilotOverlay").then((m) => ({ default: m.CopilotOverlay })),
);
const WordCountModal = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/WordCountModal").then((m) => ({ default: m.WordCountModal })), { warm: true }),
  () => useSettingsStore((s) => s.wordCountOpen),
  () => useSettingsStore.getState().setWordCountOpen(false),
  { loading: <OpeningIndicator /> },
);
const VersioningModal = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/VersioningModal").then((m) => ({
      default: m.VersioningModal,
    })), { warm: true }),
  () => useSettingsStore((s) => s.versioningOpen),
  () => useSettingsStore.getState().closeVersioning(),
  { loading: <OpeningIndicator /> },
);
const HotkeysModal = mountOnFirstOpen(
  lazy(() =>
    import("@/components/editor/HotkeysModal").then((m) => ({ default: m.HotkeysModal })), { warm: true }),
  () => useSettingsStore((s) => s.hotkeysOpen),
  () => useSettingsStore.getState().setHotkeysOpen(false),
  { loading: <OpeningIndicator /> },
);
const TourGuide = mountOnFirstOpen(
  lazy(() => import("@/components/tour/TourGuide").then((m) => ({ default: m.TourGuide }))),
  useTourGuideWanted,
  () => useTourStore.getState().stop(),
  { useResetKey: useTourStartRequests },
);
const LanguageServiceRuntime = mountOnFirstOpen(
  LanguageServiceRuntimeBoundary,
  () => useFilesStore((s) => s.projectId !== null),
  undefined,
  {
    useResetKey: () => useFilesStore((s) => s.projectId),
    fallback: <LanguageServiceRuntimeUnavailable />,
  },
);
const StatsToolView = lazy(() =>
  import("@/components/tools/StatsToolView").then((m) => ({ default: m.StatsToolView })), { warm: true });
const GeneratorsToolView = lazy(() =>
  import("@/components/tools/GeneratorsToolView").then((m) => ({ default: m.GeneratorsToolView })), { warm: true });
const SymbolsToolView = lazy(() =>
  import("@/components/tools/SymbolsToolView").then((m) => ({ default: m.SymbolsToolView })), { warm: true });
const EquationToolView = lazy(() =>
  import("@/components/tools/EquationToolView").then((m) => ({ default: m.EquationToolView })), { warm: true, priority: HEAVY });
const ConverterToolView = lazy(() =>
  import("@/components/tools/ConverterToolView").then((m) => ({ default: m.ConverterToolView })), { warm: true });
const ReferenceToolView = lazy(() =>
  import("@/components/tools/ReferenceToolView").then((m) => ({ default: m.ReferenceToolView })), { warm: true, priority: HEAVY });
const LiteratureSearchToolView = lazy(() =>
  import("@/components/tools/LiteratureSearchToolView").then((m) => ({
    default: m.LiteratureSearchToolView,
  })), { warm: true });
const TerminalDock = lazy(() =>
  import("@/components/dock/TerminalDock").then((m) => ({ default: memo(m.TerminalDock) })), { warm: true, priority: HEAVY });
const EnginePickerModal = lazy(() =>
  import("@/components/layout/EnginePickerModal").then((m) => ({ default: m.EnginePickerModal })), { warm: true });
const MainDocumentPicker = lazy(() =>
  import("@/components/open-folder/MainDocumentPicker").then((m) => ({ default: m.MainDocumentPicker })), { warm: true });
const CopyIntoLibraryDialog = lazy(() =>
  import("@/components/library/CopyIntoLibraryDialog").then((m) => ({ default: m.CopyIntoLibraryDialog })), { warm: true });
const QuickActionOffer = lazy(() =>
  import("@/components/layout/QuickActionOffer").then((m) => ({ default: m.QuickActionOffer })),
);
const CodeExecutionBanner = lazy(() =>
  import("@/components/layout/CodeExecutionBanner").then((m) => ({ default: m.CodeExecutionBanner })),
);
const TypstCjkFontBanner = lazy(() =>
  import("@/components/layout/TypstCjkFontBanner").then((m) => ({ default: m.TypstCjkFontBanner })),
);

function CodeExecutionSlot() {
  const blocked = useFilesStore(
    (state) => state.projectId !== null && isNotebookEngine(state.engine) && !state.engine.allow_shell_escape,
  );
  if (!blocked) return null;
  return (
    <Suspense fallback={null}>
      <CodeExecutionBanner />
    </Suspense>
  );
}

function TypstCjkFontSlot() {
  const typst = useFilesStore((state) => state.projectId !== null && state.engine.source_format === "typst");
  if (!typst) return null;
  return (
    <Suspense fallback={null}>
      <TypstCjkFontBanner />
    </Suspense>
  );
}

const WorkspaceSidebar = memo(Sidebar);
const WorkspaceEditor = memo(Editor);
const WorkspacePreview = memo(PreviewPane);
const WorkspaceAssistant = memo(ChatPanel);

function LazyModals({ children }: Readonly<{ children: ReactNode }>) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

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

function closeAssistant() {
  const settings = useSettingsStore.getState();
  if (settings.assistantOpen) settings.setAssistantOpen(false);
}

function closeTerminal() {
  if (useSettingsStore.getState().terminalOpen) useSettingsStore.getState().setTerminalOpen(false);
}

function openTerminal() {
  if (!useSettingsStore.getState().terminalOpen) useSettingsStore.getState().setTerminalOpen(true);
}

function workspaceGroupId(projectId: string | null, group: string): string | undefined {
  return projectId ? workspacePanelId(projectId, group) : undefined;
}

const AUTO_COMPILE_DEBOUNCE_MS = 2500;
const WINDOW_WAKE_COALESCE_MS = 1_000;
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

type RichTextHost = HTMLElement & { editor?: RichTextEditor };

function visualEditorOwns(element: Element | null): boolean {
  const visual = getWysiwygEditor();
  return !!element && !!visual && !visual.isDestroyed && visual.view.dom.contains(element);
}

function separateRichTextEditor(element: Element | null): RichTextHost | null {
  const host = element?.closest<RichTextHost>(".ProseMirror") ?? null;
  return host && !visualEditorOwns(host) ? host : null;
}

function runRichTextHistory(host: RichTextHost, redo: boolean): void {
  const chain = host.editor?.chain().focus();
  if (redo) chain?.redo().run();
  else chain?.undo().run();
}

function recompileWanted(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (separateRichTextEditor(target)) return false;
  return !event.defaultPrevented || !!target?.closest(".cm-editor") || visualEditorOwns(target);
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
  const active = document.activeElement as HTMLElement | null;
  const noteHistory = inPlainField(active) ? null : noteHistoryAt(active);
  if (noteHistory) {
    noteHistory(redo);
    return;
  }
  const richText = separateRichTextEditor(active);
  if (richText) {
    runRichTextHistory(richText, redo);
    return;
  }
  if (!useFilesStore.getState().projectId || projectCovered()) {
    if (inPlainField(active)) runFieldHistory(document, redo ? "redo" : "undo");
    return;
  }
  const form = visualFormHistory(active);
  if (form === "document") {
    runDocumentMenuHistory(active, redo);
    return;
  }
  if (form === "field" || inPlainField(active)) {
    runFieldHistory(document, redo ? "redo" : "undo");
    return;
  }
  if (secondaryCodeEditorOwns(active)) {
    runSecondaryEditorHistory(active, redo);
    return;
  }
  runDocumentMenuHistory(active, redo);
}

function loadMcpBridge(): Promise<() => void> {
  return import("@/lib/mcp-bridge").then((m) => m.startMcpBridge());
}

function loadStuckWindowRestore(): Promise<() => void> {
  return import("@/lib/stuck-window-restore").then((m) => m.startStuckWindowRestore());
}

function loadResearchPdfBridge(): Promise<() => void> {
  return import("@/lib/research-pdf-bridge").then((m) => m.mountResearchPdfBridge());
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

function AppContent() {
  const { t } = useTranslation(["workspace"]);
  const [aboutOpen, setAboutOpen] = useState(false);
  const projectId = useFilesStore((s) => s.projectId);
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
  const editorCjkFontFamily = useSettingsStore((s) => s.editorCjkFontFamily);
  const editorUsesAppFont = useSettingsStore((s) => s.editorUsesAppFont);
  const editorLineHeight = useSettingsStore((s) => s.editorLineHeight);
  const editorCustomLineHeight = useSettingsStore((s) => s.editorCustomLineHeight);
  const editorCursorWidth = useSettingsStore((s) => s.editorCursorWidth);
  const editorLetterSpacing = useSettingsStore((s) => s.editorLetterSpacing);
  const editorCustomLetterSpacing = useSettingsStore((s) => s.editorCustomLetterSpacing);
  const editorCursorColorLight = useSettingsStore((s) => s.editorCursorColorLight);
  const editorCursorColorDark = useSettingsStore((s) => s.editorCursorColorDark);
  const editorColors = useSettingsStore((s) => s.editorColors);
  const activeEditorColorKey = useEditorColorKey();
  const accentColor = useSettingsStore((s) => s.accentColor);
  const chatFloating = useSettingsStore((s) => s.chatFloating);
  const terminalOpen = useSettingsStore((s) => s.terminalOpen);
  const assistantOpen = useSettingsStore((s) => s.assistantOpen);
  const workspaceHidden = useSettingsStore((s) => s.workspaceHidden);
  const zen = useZenStore((s) => s.active);
  const zenProjectId = useZenStore((s) => s.projectId);
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
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);
  const editorPanelRef = useRef<PanelImperativeHandle>(null);
  const pdfPanelRef = useRef<PanelImperativeHandle>(null);
  const terminalPanelRef = useRef<PanelImperativeHandle>(null);
  const assistantPanelRef = useRef<PanelImperativeHandle>(null);
  const sidebarHost = useKeptAliveHost("h-full min-h-0 min-w-0");
  const editorHost = useKeptAliveHost("h-full min-h-0 min-w-0");
  const terminalHost = useKeptAliveHost("h-full min-h-0 min-w-0");
  const assistantHost = useKeptAliveHost("h-full min-h-0 min-w-0");
  const paneLayout = usePaneLayoutStore((s) => s.layout);
  const paneRootElement = useRef<HTMLDivElement>(null);
  const sidebarParent = parentSplitOf(paneLayout, "sidebar");
  const sidebarGroupId = workspaceGroupId(projectId, sidebarParent ? groupNameOf(sidebarParent) : "horizontal");
  const terminalParent = parentSplitOf(paneLayout, "terminal");
  const terminalGroupName = terminalParent ? groupNameOf(terminalParent) : "vertical";
  const shownPanes = useMemo<PaneShown>(
    () => ({
      sidebar: showTree,
      editor: !workspaceHidden && viewMode !== "pdf",
      pdf: !workspaceHidden && viewMode !== "editor",
      terminal: terminalOpen,
      assistant: assistantOpen,
    }),
    [assistantOpen, showTree, terminalOpen, viewMode, workspaceHidden],
  );
  const hasStoredSidebarLayout = useMemo(
    () => (sidebarGroupId ? hasStoredPanelLayout(sidebarGroupId) : false),
    [sidebarGroupId],
  );
  const separatorHitArea = useSeparatorHitArea(0.375);

  useLayoutEffect(() => {
    if (projectId) return restoreWorkspaceLayout(projectId);
  }, [projectId]);

  useEffect(() => {
    if (zenProjectId !== null && zenProjectId !== projectId) exitZenMode({ restoreLayout: false });
  }, [projectId, zenProjectId]);

  useLayoutEffect(() => {
    if (!projectId) return;
    const groupId = workspacePanelId(projectId, terminalGroupName);
    return afterPanelLayout(
      () => terminalPanelRef.current,
      (panel) => {
        if (terminalOpen) expandPanel(groupId, "terminal", panel, 30);
        else collapsePanel(groupId, "terminal", panel);
      },
    );
  }, [terminalOpen, projectId, terminalGroupName]);

  useOpenFolderIntake();
  useTemplateLinkIntake();

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
  const paneTree = useMemo<PaneTreeConfig>(
    () => ({
      projectId,
      shown: shownPanes,
      terminalOpen,
      workspaceHidden,
      showTree,
      documentDefaultSize: workspacePanelDefaultSize,
      sidebarDefaultSize,
      sidebarMinSize,
      assistantMinSize,
      assistantDefaultSize,
      hosts: {
        sidebar: sidebarHost,
        editor: editorHost,
        pdf: previewHost,
        terminal: terminalHost,
        assistant: assistantHost,
      },
      panelRefs: {
        sidebar: sidebarPanelRef,
        editor: editorPanelRef,
        pdf: pdfPanelRef,
        terminal: terminalPanelRef,
        assistant: assistantPanelRef,
      },
      separatorHitArea,
      rootRef: paneRootElement,
      onAssistantDismiss: closeAssistant,
      onTerminalCollapse: closeTerminal,
      onTerminalExpand: openTerminal,
    }),
    [
      assistantDefaultSize,
      assistantHost,
      assistantMinSize,
      editorHost,
      previewHost,
      projectId,
      separatorHitArea,
      shownPanes,
      showTree,
      sidebarDefaultSize,
      sidebarHost,
      sidebarMinSize,
      terminalHost,
      terminalOpen,
      workspaceHidden,
      workspacePanelDefaultSize,
    ],
  );
  const visiblePanes = useMemo(
    () => (Object.keys(shownPanes) as PaneId[]).filter((pane) => shownPanes[pane]),
    [shownPanes],
  );

  useEffect(() => {
    markBootStage("react-mounted");
    if (!bootSplashHeld()) dismissBootSplash();
    void refreshProjects();
    markBootStage("stores-ready");
  }, [refreshProjects]);

  useEffect(() => {
    if (!projectId) {
      const home = useHomeViewStore.getState();
      home.goTo(home.consumeQueuedPageAfterProjectClose() ?? "library");
    }
  }, [projectId]);

  useSteadyPanelWidth({
    panelRef: sidebarPanelRef,
    active: showTree && sidebarParent?.direction === "row",
    groupWidth: panelGroupWidth,
    defaultSize: sidebarDefaultSize,
    applyDefault: !hasStoredSidebarLayout,
  });

  useEffect(() => {
    const id = window.setTimeout(() => checkForUpdatesOnStartup(), 3000);
    return () => window.clearTimeout(id);
  }, []);

  const native = isTauri();

  useTauriEvent("menu://check-updates", () => void openUpdateWindow({ manual: true }), native);
  useTauriEvent("menu://about", () => setAboutOpen(true), native);
  useTauriSubscription(startNativeDockShortcutBridge, "start the dock shortcut bridge");

  useEffect(() => {
    if (!native) return;
    void import("@/lib/ai-tools").then((m) => m.initAiPdfCaptureFlag());
    void import("@/lib/desktop-apps").then((m) => m.syncDesktopAppsTool());
  }, [native]);
  useTauriSubscription(native ? loadMcpBridge : null, "start the MCP bridge");
  useTauriSubscription(native ? loadResearchPdfBridge : null, "start the research PDF bridge");
  useTauriSubscription(
    native ? loadStuckWindowRestore : null,
    "reopen the work after a stuck window reload",
  );
  useTauriSubscription(
    native ? startDefaultLatexEngineSync : null,
    "sync the default compile engine",
  );

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--cm-font-size", `${editorUsesAppFont ? appFontSize : editorFontSize}px`);
    applyAppTypography(appFontFamily, appFontSize, root);
    const editorFont = fontFamilyName(editorFontFamily);
    const cjkFont = editorUsesAppFont ? "" : fontFamilyName(editorCjkFontFamily);
    if (cjkFont) root.style.setProperty("--cm-cjk-font", quotedFontFamily(cjkFont));
    else root.style.removeProperty("--cm-cjk-font");
    if (editorUsesAppFont) {
      root.style.setProperty("--cm-font-family", "var(--font-sans)");
    } else if (cjkFont) {
      root.style.setProperty("--cm-font-family", editorCjkFontStack(editorFont, cjkFont, "var(--font-mono)"));
    } else if (editorFont) {
      root.style.setProperty("--cm-font-family", fontFamilyStack(editorFont, "var(--font-mono)"));
    } else {
      root.style.removeProperty("--cm-font-family");
    }
    root.style.setProperty(
      "--cm-line-height",
      String(editorLineHeightValue(editorLineHeight, editorCustomLineHeight)),
    );
    root.style.setProperty(
      "--cm-letter-spacing",
      `${editorLetterSpacingValue(editorLetterSpacing, editorCustomLetterSpacing)}px`,
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
    editorCjkFontFamily,
    editorUsesAppFont,
    editorLineHeight,
    editorCustomLineHeight,
    editorLetterSpacing,
    editorCustomLetterSpacing,
    editorCursorWidth,
    editorCursorColorLight,
    editorCursorColorDark,
  ]);

  useEffect(() => {
    applyEditorColors(editorColors[activeEditorColorKey] ?? {});
  }, [editorColors, activeEditorColorKey]);

  useEffect(() => {
    const apply = (theme: Theme) => applyAccentColor(theme, accentColor);
    apply(currentTheme());
    return subscribeTheme(apply);
  }, [accentColor]);

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
    useCompileStore.getState().reset();
    usePreflightStore.getState().reset();
    if (projectId) {
      s.setRailTab("files");
    }
  }, [projectId]);

  useEffect(() => {
    void import("@/lib/preview-window").then((m) => m.restorePreviewWindow(projectId, useFilesStore.getState().projectName ?? ""));
  }, [projectId]);

  useTauriSubscription(startPreviewWorkspaceBridge, "start the preview workspace bridge");

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
  useTauriEvent<{ projectId?: string; path?: string }>(
    "pdf-sync:written",
    (payload) => {
      if (payload?.projectId && payload.path) {
        useFilesStore.getState().addGeneratedFile(payload.projectId, payload.path);
      }
    },
    native,
  );
  useTauriEvent<ProjectStateChanged>(
    "project-state-changed",
    (payload) => {
      const files = useFilesStore.getState();
      if (!payload || payload.projectId !== files.projectId) return;
      void files.applyProjectStateChanged(payload).then((applied) => {
        if (applied) usePreflightStore.getState().reset();
        if (useFilesStore.getState().projectId === payload.projectId) {
          void useTypstFormsStore.getState().refresh();
        }
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId) return;
      const bindings = useShortcutStore.getState().bindings;
      if (matchesShortcut(e, bindings.recompile)) {
        if (projectCovered() || !recompileWanted(e)) return;
        e.preventDefault();
        revealPreviewForCompile();
        void recompile();
      } else if (matchesShortcut(e, bindings.forwardSync)) {
        if (projectCovered()) return;
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
      if (!useFilesStore.getState().projectId || projectCovered()) return;
      if (terminalOwnsKey(e)) return;
      if (matchesShortcut(e, useShortcutStore.getState().bindings.toggleSidebar)) {
        const el = document.activeElement as HTMLElement | null;
        if (el?.closest(".cm-editor") || el?.closest(".ProseMirror") || inVisualForm(el)) return;
        e.preventDefault();
        e.stopPropagation();
        useSettingsStore.getState().toggleTree();
      } else if (matchesShortcut(e, useShortcutStore.getState().bindings.togglePreview)) {
        if (!togglePreviewPane()) return;
        e.preventDefault();
        e.stopPropagation();
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
      if (isTerminalTarget(e.target)) return;
      const isRedo = command === "redo";
      if (useTourStore.getState().activeTourId) return;
      const focused = document.activeElement;
      const noteHistory = focused?.closest(".ProseMirror") || inPlainField(focused) ? null : noteHistoryAt(focused);
      if (noteHistory) {
        e.preventDefault();
        e.stopPropagation();
        noteHistory(isRedo);
        return;
      }
      if (!useFilesStore.getState().projectId || projectCovered()) return;
      const active = document.activeElement as HTMLElement | null;
      if (inVisualForm(active)) return;
      if (secondaryCodeEditorOwns(active) || separateRichTextEditor(active)) return;
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
    if (!projectId) return;
    const onKey = (event: KeyboardEvent) => {
      if (useTourStore.getState().activeTourId || projectCovered()) return;
      if (handleTerminalTabShortcut(event)) return;
      if (!usesNativeDockMenu()) handleDockShortcut(event);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [projectId]);

  if (!projectId) {
    return (
      <ThemeProvider>
        <ErrorBoundary surface="library" resetKey={homePage}>
          <Library />
        </ErrorBoundary>
        <Contained resetKey={homePage}>
          <CommandPalette />
        </Contained>
        <Contained resetKey={homePage}>
          <SearchOmnibar />
        </Contained>
        <GlobalNewProject />
        <LazyModals>
          <Contained resetKey={homePage}>
            <CopyIntoLibraryDialog />
          </Contained>
        </LazyModals>
        <Contained resetKey={homePage}>
          <SaveAsTemplateHost />
        </Contained>
        <ErrorBoundary surface="tool" resetKey={homePage}>
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
        </ErrorBoundary>
        <Contained resetKey={homePage}>
          <ExternalToolApprovals />
        </Contained>
        <LazyModals>
          <Contained resetKey={homePage}>
            <EnginePickerModal />
          </Contained>
        </LazyModals>
        <Contained resetKey={homePage}>
          <TinytexGuards />
        </Contained>
        <Contained resetKey={homePage}>
          <QuitGuard />
        </Contained>
        <Contained resetKey={homePage}>
          <SaveBlockedDialog />
        </Contained>
        <Contained resetKey={homePage}>
          <OpenFolderStopDialog />
        </Contained>
        <LazyModals>
          <Contained resetKey={homePage}>
            <QuickActionOffer />
          </Contained>
        </LazyModals>
        <Contained resetKey={aboutOpen} close={() => setAboutOpen(false)}>
          <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        </Contained>
        {chatFloating && (
          <Suspense fallback={null}>
            <Contained resetKey={homePage}>
              <CopilotOverlay />
            </Contained>
          </Suspense>
        )}
        <SettingsModal />
        <Contained resetKey={homePage}>
          <CiteOleaflyDialog />
        </Contained>
        <HotkeysModal />
        <DiagramComposer />
        <NotesHost />
        <ShareDialogHost overNotes />
        <DiagramComposerChooserHost />
        <TourGuide />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <div
        data-sidebar-open={showTree ? "true" : "false"}
        data-zen={zen ? "true" : undefined}
        className="flex h-full flex-col"
      >
        <div className="contents" inert={coversProject(homePage) || undefined}>
          <div hidden={zen} className={zen ? undefined : "contents"}>
            <Contained resetKey={projectId}>
              <TopToolbar />
            </Contained>
          </div>
          {zen && (
            <Contained resetKey={projectId} close={exitZenMode}>
              <ZenTitleStrip />
            </Contained>
          )}
        <Contained resetKey={projectId}>
          <BackendProtocolBanner />
        </Contained>
        <Contained resetKey={projectId}>
          <FolderUnavailableBanner />
        </Contained>
        <Contained resetKey={projectId}>
          <OpenedFolderBanners />
        </Contained>
        <Contained resetKey={projectId}>
          <CollabSyncPauseSlot />
        </Contained>
        <Contained resetKey={projectId}>
          <CollabActivitySlot />
        </Contained>
        <Contained resetKey={projectId}>
          <ShellCommandsBanner />
        </Contained>
        <Contained resetKey={projectId}>
          <CodeExecutionSlot />
        </Contained>
        <Contained resetKey={projectId}>
          <TypstCjkFontSlot />
        </Contained>
        <div ref={panelAreaRef} className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <PaneReorderProvider rootRef={paneRootElement} visiblePanes={visiblePanes}>
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
            <PaneTreeProvider value={paneTree}>
              <PaneTreeGroup key={`${projectId}:${groupNameOf(paneLayout)}`} node={paneLayout} root />
            </PaneTreeProvider>
            {shownPanes.sidebar && createPortal(<WorkspaceSidebar />, sidebarHost, `sidebar:${projectId}`)}
            {shownPanes.editor &&
              createPortal(
                <ErrorBoundary surface="editor" resetKey={projectId}>
                  <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.editor)} />}>
                    <WorkspaceEditor />
                  </Suspense>
                </ErrorBoundary>,
                editorHost,
                `editor:${projectId}`,
              )}
            {shownPanes.assistant &&
              createPortal(
                <ErrorBoundary surface="AI assistant" resetKey={projectId}>
                  <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.assistant)} />}>
                    <WorkspaceAssistant />
                  </Suspense>
                </ErrorBoundary>,
                assistantHost,
                `assistant:${projectId}`,
              )}
            {createPortal(
              <div className={cn("h-full min-h-0 min-w-0", !terminalOpen && "invisible pointer-events-none")}>
                <ErrorBoundary surface="terminal dock" resetKey={projectId}>
                  <Suspense fallback={<SurfaceLoading label={t(($) => $.workspace.surfaces.terminal)} />}>
                    <TerminalDock projectId={projectId} visible={terminalOpen} />
                  </Suspense>
                </ErrorBoundary>
              </div>,
              terminalHost,
              `terminal:${projectId}`,
            )}
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
          </PaneReorderProvider>
        </div>

        <Contained resetKey={projectId}>
          <CommandPalette />
        </Contained>
        <Contained resetKey={projectId}>
          <SearchOmnibar />
        </Contained>
        <GlobalNewProject />
        <LazyModals>
          <Contained resetKey={projectId}>
            <CopyIntoLibraryDialog />
          </Contained>
        </LazyModals>
        <Contained resetKey={projectId}>
          <SaveAsTemplateHost />
        </Contained>
        <Contained resetKey={projectId}>
          <AssistantOutputsBridge />
        </Contained>
        <Contained resetKey={projectId}>
          <ExternalToolApprovals />
        </Contained>
        <LazyModals>
          <Contained resetKey={projectId}>
            <EnginePickerModal />
          </Contained>
          <Contained resetKey={projectId}>
            <MainDocumentPicker />
          </Contained>
        </LazyModals>
        <Contained resetKey={projectId}>
          <TinytexGuards />
        </Contained>
        <Contained resetKey={projectId}>
          <QuitGuard />
        </Contained>
        <Contained resetKey={projectId}>
          <SaveBlockedDialog />
        </Contained>
        <Contained resetKey={projectId}>
          <OpenFolderStopDialog />
        </Contained>
        <LazyModals>
          <Contained resetKey={projectId}>
            <QuickActionOffer />
          </Contained>
        </LazyModals>
        <Contained resetKey={aboutOpen} close={() => setAboutOpen(false)}>
          <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
        </Contained>
        {chatFloating && !zen && (
          <Suspense fallback={null}>
            <Contained resetKey={projectId}>
              <CopilotOverlay />
            </Contained>
          </Suspense>
        )}
        {zen && (
          <Contained resetKey={projectId} close={exitZenMode}>
            <ZenSession />
          </Contained>
        )}
        {zen && (
          <Contained resetKey={projectId}>
            <ZenCompileCorner />
          </Contained>
        )}
        <Contained resetKey={projectId}>
          <CiteOleaflyDialog />
        </Contained>
        <WordCountModal />
        <VersioningModal />
        <HotkeysModal />
        <TourGuide />
        </div>
        <SettingsModal />
        <DiagramComposer />
        <NotesHost />
        <ShareDialogHost overNotes />
        <DiagramComposerChooserHost />
        {projectToolOpen && (
          <Contained resetKey={homePage} close={() => useHomeViewStore.getState().goTo("library")}>
            <Suspense fallback={null}>
              <div className="fixed inset-0 z-[70]">
                {homePage === "generators" ? <GeneratorsToolView /> : <SymbolsToolView />}
              </div>
            </Suspense>
          </Contained>
        )}
      </div>
    </ThemeProvider>
  );
}

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
  const projectId = useFilesStore((state) => state.projectId);
  useEffect(() => startWarming((error) => void logError("load a view ahead of time", error)), []);
  useEffect(
    () =>
      useSettingsStore.subscribe((state, previous) => {
        if (state.notes && !previous.notes) warmDeferred();
      }),
    [],
  );
  return (
    <>
      <LanguageServiceRuntime />
      <Contained resetKey={projectId}>
        <AutoCompileKeeper />
      </Contained>
      <Contained resetKey={projectId}>
        <ProjectAvailabilityKeeper />
      </Contained>
      <Contained resetKey={projectId}>
        <OpenFolderKeeper />
      </Contained>
      <Contained resetKey={projectId}>
        <FolderWatchKeeper />
      </Contained>
      <Contained resetKey={projectId}>
        <CloudSyncHost />
      </Contained>
      <Contained resetKey={projectId}>
        <CollabLiveKeeper />
      </Contained>
      <Contained resetKey={projectId}>
        <CollabLinkKeeper />
      </Contained>
      <AppContent />
      <Contained resetKey={projectId}>
        <OpenCompileKeeper />
      </Contained>
    </>
  );
}
